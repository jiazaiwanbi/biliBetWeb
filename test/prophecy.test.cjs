const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('../bilibili-live-prophecy.user.js');
const now = 1794070000000;
const item = (status = 1, overrides = {}) => ({ prophet: { prophet_id: 46542, prophet_status: status, count_down_time: now / 1000 + 90, smh_spend: 5, answer_count: { a: 372, b: 175 }, ...overrides }, my_answer: 0 });
const context = { uid: '10001', anchorId: '20002', balance: 791 };

test('deadline closes voting even when the server still reports status 1', () => {
  const expired = item(1, { count_down_time: now / 1000 });
  assert.equal(helpers.statusOf(expired, now).label, '未公布');
  assert.match(helpers.validateVote(expired, 1, context, now), /截止/);
  assert.equal(helpers.secondsLeft(expired.prophet, now + 5000), 0);
});
test('the nearest active deadline wins over pending and settled records', () => {
  const active = item();
  const nearer = item(1, { count_down_time: now / 1000 + 12 });
  assert.deepEqual(helpers.summaryOf([item(3), item(2), active, nearer], now), { kind: 'active', label: '00:12', count: 2 });
  assert.equal(helpers.summaryOf([item(3), item(2)], now).label, '未公布');
  assert.equal(helpers.summaryOf([item(3)], now).label, '已公布');
  assert.equal(helpers.summaryOf([], now).label, '暂无预言');
});
test('all mobile server status codes have distinct readable states', () => {
  assert.deepEqual([0,1,2,3,4].map(s => helpers.statusOf(item(s), now).label), ['未开始','进行中','未公布','已公布','已取消']);
});
test('votes require the viewer, an unexpired question, balance, and no prior choice', () => {
  assert.equal(helpers.validateVote(item(), 2, context, now), '');
  assert.match(helpers.validateVote(item(), 1, { ...context, uid: '' }, now), /登录/);
  assert.match(helpers.validateVote(item(), 1, { ...context, uid: context.anchorId }, now), /自己/);
  assert.match(helpers.validateVote(item(), 1, { ...context, balance: null }, now), /余额/);
  assert.match(helpers.validateVote(item(), 1, { ...context, balance: 4 }, now), /不足/);
  assert.match(helpers.validateVote({ ...item(), my_answer: 1 }, 2, context, now), /重复参与/);
  assert.match(helpers.validateVote(item(4), 1, context, now), /截止/);
});
test('the reward estimate uses the mobile pool formula and includes the new voter', () => {
  assert.equal(helpers.estimatedProfit(item().prophet, 1, true), Math.floor(5 * 175 / 373));
  assert.equal(helpers.estimatedProfit(item(1, { answer_count: { a: 0, b: 10 } }).prophet, 1, true), 50);
});
test('active and pending questions stay above a recently published result', () => {
  const ordered = helpers.sortItems([item(3,{prophet_id:3,push_time:999}), item(2,{prophet_id:2}), item(1,{prophet_id:1})], now);
  assert.deepEqual(ordered.map(x=>x.prophet.prophet_id), [1,2,3]);
});
test('question and answer text cannot inject HTML into the panel', () => {
  assert.equal(helpers.esc('<img src=x onerror="x()">&'), '&lt;img src=x onerror=&quot;x()&quot;&gt;&amp;');
});

test('history uses the correct answer, actual signed change, and local publication timestamp', () => {
  const publication = new Date(2026, 10, 6, 19, 10, 50).getTime() / 1000;
  const entry = {
    ...item(3, { question: {question:'胡牌？',answer_a:'能',answer_b:'不能'},correct_answer:2,publish_time:publication,push_time:publication-600,anchor_name:'备用主播' }),
    my_answer:1,smh_num_change:-5,anchor_name:'青铜树海'
  };
  assert.deepEqual(helpers.historyDetails(entry), { question:'胡牌？',answer:'不能',delta:-5,time:'2026-11-06 19:10:50',anchor:'青铜树海' });
  assert.equal(helpers.historyDetails({...entry,smh_num_change:79}).delta, 79);
  assert.equal(helpers.historyDetails({...entry,smh_num_change:0}).delta, 0);
});

test('history never invents a settlement or replaces missing publication time with question creation time', () => {
  const entry = item(2, {push_time:1793991582});
  const details = helpers.historyDetails(entry);
  assert.equal(details.answer, '未公布');
  assert.equal(details.delta, null);
  assert.equal(details.time, '—');
  assert.equal(helpers.historyDetails({...entry,smh_num_change:''}).delta, null);
  assert.equal(helpers.historyDetails({...entry,smh_num_change:'invalid'}).delta, null);
});

test('fullscreen positions apply to native fullscreen and viewport-filling webpage fullscreen only', () => {
  assert.equal(helpers.isFullscreenView(true, null, 1366, 900), true);
  assert.equal(helpers.isFullscreenView(false, {left:0,top:0,width:1366,height:900}, 1366, 900), true);
  assert.equal(helpers.isFullscreenView(false, {left:28,top:185,width:980,height:660}, 1366, 900), false);
  assert.equal(helpers.isFullscreenView(false, {left:0,top:0,width:1366,height:660}, 1366, 900), false);
  assert.equal(helpers.isFullscreenView(false, null, 1366, 900), false);
});
