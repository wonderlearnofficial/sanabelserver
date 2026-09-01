const test = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();

// Opt in explicitly. Never sync, seed, truncate, or use production fixtures.
const enabled = process.env.RUN_GAMEPLAY_INTEGRATION === 'true';
test('personal gameplay: real HTTP, real MySQL transactions and concurrent retries', { skip: !enabled }, async (t) => {
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MYSQL_DB_HOST), 'Only a loopback DB is allowed');
  process.env.DB_SYNC_ON_STARTUP = 'false';
  const { sequelize, rundb } = require('../dist/config/db_connection');
  const model = name => require(`../dist/models/${name}.model`).default;
  const User = model('user'), Student = model('student'), Task = model('task');
  const StudentTask = model('student-task'), Challenge = model('challenge');
  const StudentChallenge = model('student-challenge'), Tree = model('tree');
  const Category = model('task-category');
  const express = require('express');
  const { signAccessToken } = require('../dist/helpers/tokens');
  const created = [];
  let server;
  const remember = async (Model, values) => {
    const row = await Model.create(values);
    created.push([Model, Model === StudentChallenge ? { studentId: row.studentId, challengeId: row.challengeId } : { id: row.id }]);
    return row;
  };
  try {
    await rundb();
    await sequelize.authenticate();
    const suffix = `gameplay_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const user = await remember(User, { firstName: 'Gameplay', lastName: 'Test', role: 'Student', email: `${suffix}@example.invalid`, password: 'unused-test-password', isAccess: true });
    const trees = await Tree.findAll({ order: [['id', 'ASC']], limit: 2 });
    assert.equal(trees.length, 2, 'Existing tree catalog required');
    assert.equal(trees[0].id, 1);
    const student = await remember(Student, { userId: user.id, organizationId: null, classId: null, treeProgress: 1, connectCode: suffix.slice(-6), xp: 0, water: 0, seeders: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0 });
    const category = await Category.findOne();
    assert.ok(category, 'Existing task catalog required');
    const task = await remember(Task, { title: suffix, type: suffix, categoryId: category.id, xp: 5, snabelRed: 1, snabelBlue: 2, snabelYellow: 3 });
    const challenge = await remember(Challenge, { title: suffix, category: 'xp', point: 5, xp: 10, snabelRed: 4, snabelBlue: 4, snabelYellow: 4, water: 1, seeder: 1 });
    const row = await remember(StudentChallenge, { studentId: student.id, challengeId: challenge.id, pointOfStudent: 0, completionStatus: 'NotCompleted' });
    const app = express();
    app.use(express.json());
    app.use('/students', require('../dist/routes/student_routes').router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const token = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
    const request = async (method, path, data) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/students/${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: response.status, body: await response.json() };
    };
    const reset = values => Student.update({ xp: 0, treeProgress: 1, water: 0, seeders: 0, snabelRed: 0, snabelBlue: 0, snabelYellow: 0, ...values }, { where: { id: student.id } });
    const complete = () => request('POST', 'add-pros', { taskId: task.id, time: '2020-01-01T23:59:59.000Z' });

    await t.test('parallel completion records one UTC-day task and grants one full reward bundle', async () => {
      const results = await Promise.all([complete(), complete()]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
      assert.equal(results.filter(r => r.body.alreadyCompleted).length, 1);
      const records = await StudentTask.findAll({ where: { studentId: student.id } });
      assert.equal(records.length, 1);
      assert.equal(records[0].date, new Date().toISOString().slice(0, 10));
      assert.equal(records[0].completionStatus, 'Completed');
      await student.reload(); await row.reload();
      assert.deepEqual([student.xp, student.snabelRed, student.snabelBlue, student.snabelYellow, student.water, student.seeders], [15, 5, 6, 7, 1, 1]);
      assert.equal(row.pointOfStudent, 5);
      assert.equal(row.completionStatus, 'Completed');
      const profile = await request('GET', 'data');
      assert.equal(profile.status, 200);
      assert.ok(profile.body.data.completedTasks.taskIds.includes(task.id));
      const catalog = await request('GET', `appear-Taskes-Type-Category/${category.id}/${task.type}`);
      assert.equal(catalog.status, 200);
      assert.equal(catalog.body.tasks.find(r => r.id === task.id).completionStatus, 'Completed');
      const count = await request('GET', 'task-count-sucess');
      assert.equal(count.status, 200);
      assert.equal(count.body.completedTasksCount, 1);
    });

    for (const [water, seeders, cost] of [[1, 0, 10], [0, 1, 15], [1, 1, 25]]) {
      await t.test(`exact balance purchase water=${water} fertilizer=${seeders}`, async () => {
        await reset({ snabelRed: cost, snabelBlue: cost, snabelYellow: cost });
        const result = await request('PATCH', 'buy-water-seeder', { water, seeders });
        assert.equal(result.status, 200);
        await student.reload();
        assert.deepEqual([student.water, student.seeders, student.snabelRed, student.snabelBlue, student.snabelYellow], [water, seeders, 0, 0, 0]);
      });
    }
    await t.test('parallel purchases cannot overspend the same balance', async () => {
      await reset({ snabelRed: 10, snabelBlue: 10, snabelYellow: 10 });
      const results = await Promise.all([1, 2].map(() => request('PATCH', 'buy-water-seeder', { water: 1 })));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
      await student.reload();
      assert.equal(student.water, 1);
      assert.equal(student.snabelRed, 0);
      assert.equal(student.snabelBlue, 0);
      assert.equal(student.snabelYellow, 0);
    });
    await t.test('invalid quantities never charge or credit inventory', async () => {
      await reset({ snabelRed: 100, snabelBlue: 100, snabelYellow: 100 });
      for (const water of [0, -1, 0.5, 'invalid', '', null, true, [], {}, Number.MAX_SAFE_INTEGER + 1]) {
        const result = await request('PATCH', 'buy-water-seeder', { water });
        assert.equal(result.status, 400, JSON.stringify(water));
      }
      await student.reload();
      assert.equal(student.water, 0);
      assert.equal(student.snabelRed, 100);
    });
    await t.test('a save failure rolls back mission row and rewards', async () => {
      await StudentTask.destroy({ where: { studentId: student.id } });
      await reset({});
      const hook = instance => { if (instance.id === student.id) throw Error('Injected gameplay rollback test'); };
      Student.hooks.addListener('beforeSave', hook);
      try { assert.equal((await complete()).status, 500); }
      finally { Student.hooks.removeListener('beforeSave', hook); }
      assert.equal(await StudentTask.count({ where: { studentId: student.id } }), 0);
      await student.reload();
      assert.equal(student.xp, 0);
      const count = await request('GET', 'task-count-sucess');
      assert.equal(count.status, 200);
      assert.equal(count.body.completedTasksCount, 0);
    });
    await t.test('a purchase save failure rolls back challenge progress and resources', async () => {
      const purchaseChallenge = await remember(Challenge, { title: suffix + '_water', category: 'water', point: 1, xp: 10 });
      const purchaseRow = await remember(StudentChallenge, { studentId: student.id, challengeId: purchaseChallenge.id, pointOfStudent: 0, completionStatus: 'NotCompleted' });
      await reset({ snabelRed: 10, snabelBlue: 10, snabelYellow: 10 });
      const hook = instance => { if (instance.id === student.id) throw Error('Injected purchase rollback test'); };
      Student.hooks.addListener('beforeSave', hook);
      try { assert.equal((await request('PATCH', 'buy-water-seeder', { water: 1 })).status, 500); }
      finally { Student.hooks.removeListener('beforeSave', hook); }
      await student.reload(); await purchaseRow.reload();
      assert.equal(student.water, 0); assert.equal(student.xp, 0); assert.equal(student.snabelRed, 10);
      assert.equal(purchaseRow.pointOfStudent, 0); assert.equal(purchaseRow.completionStatus, 'NotCompleted');
    });
    await t.test('parallel tree growth consumes resources once and persists challenges', async () => {
      const treeChallenge = await remember(Challenge, { title: suffix + '_tree', category: 'treelevel', point: 1, xp: 7 });
      const treeRow = await remember(StudentChallenge, { studentId: student.id, challengeId: treeChallenge.id, pointOfStudent: 0, completionStatus: 'NotCompleted' });
      await reset({ water: trees[0].water, seeders: trees[0].seeders });
      const results = await Promise.all([1, 2].map(() => request('PATCH', 'grow-tree', {})));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
      await student.reload(); await treeRow.reload();
      assert.deepEqual([student.treeProgress, student.water, student.seeders, student.xp], [2, 0, 0, 7]);
      assert.equal(treeRow.completionStatus, 'Completed');
      assert.equal(results.find(r => r.status === 200).body.treePoint.id, 2);
    });
    await t.test('tree save failure rolls back consumed inventory and progress', async () => {
      await reset({ water: trees[0].water, seeders: trees[0].seeders });
      const hook = instance => { if (instance.id === student.id) throw Error('Injected tree rollback test'); };
      Student.hooks.addListener('beforeSave', hook);
      try { assert.equal((await request('PATCH', 'grow-tree', {})).status, 500); }
      finally { Student.hooks.removeListener('beforeSave', hook); }
      await student.reload();
      assert.deepEqual([student.treeProgress, student.water, student.seeders], [1, trees[0].water, trees[0].seeders]);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    // Only exact IDs created by this test. Never touch pre-existing students.
    const studentEntry = created.find(([Model]) => Model === Student);
    try {
    if (studentEntry) await StudentTask.destroy({ where: { studentId: studentEntry[1].id } });
      for (const [Model, where] of created.reverse()) await Model.destroy({ where });
    } finally {
      await sequelize.close();
    }
  }
});
