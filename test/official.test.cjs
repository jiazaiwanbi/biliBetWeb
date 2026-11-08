const test = require('node:test');
const assert = require('node:assert/strict');
const official = require('../bilibili-live-prophecy-official.user.js');

test('official page receives the resolved anchor and room IDs', () => {
  const url = new URL(official.buildOfficialUrl('26607148', 1774678));
  assert.equal(url.origin, 'https://live.bilibili.com');
  assert.equal(url.pathname, '/p/html/live-app-guessing-game/index.html');
  assert.equal(url.searchParams.get('anchorId'), '26607148');
  assert.equal(url.searchParams.get('roomId'), '1774678');
  for (const id of ['', '0', '-1', 'abc', '1&uid=2', NaN]) {
    assert.throws(() => official.buildOfficialUrl(id, 1774678), /参数无效/);
    assert.throws(() => official.buildOfficialUrl(26607148, id), /参数无效/);
  }
});

test('official launcher stops the countdown when a question expires', () => {
  const now = 1794070000000;
  const question = {prophet:{prophet_status:1, count_down_time:now/1000+12}};
  assert.equal(official.summaryOf([question], now).label, '00:12');
  assert.equal(official.summaryOf([question], now+12000).label, '未公布');
});
