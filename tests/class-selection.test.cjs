const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const schedule = require('../v2/schedule.js');
const html = fs.readFileSync(path.join(__dirname, '../v2/index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const snapshot = data => ({ exists: !!data, data: () => data });
const flush = () => new Promise(resolve => setImmediate(resolve));

function app({ online = false, now = '2026-10-27T11:39:00+09:00' } = {}) {
    const elements = {}, storage = new Map(), reads = [], writes = [], events = {}, messages = [];
    const element = id => elements[id] ||= {
        value: '', textContent: '', innerHTML: '', disabled: false, hidden: false,
        style: {}, classList: { add() {}, remove() {} }, addEventListener() {},
    };
    element('classSelect').value = '3-3-영어';
    element('classSelect').options = [...html.match(/<select id="classSelect"[\s\S]*?<\/select>/)[0].matchAll(/<option value="([^"]+)"/g)].map(m => ({ value: m[1] }));
    element('layoutSelect').value = '2x3';
    element('faceEachOther').checked = true;
    const db = { collection: () => ({ doc: id => ({
        get() { const pending = deferred(); reads.push({ id, ...pending }); return pending.promise; },
        set(data) { const pending = deferred(); writes.push({ id, data, ...pending }); return pending.promise; },
    }) }) };
    const firestore = () => online ? db : null;
    firestore.FieldValue = { serverTimestamp: () => 'server-time' };
    const context = vm.createContext({
        console, setTimeout, clearTimeout,
        ClassSchedule: { at: () => schedule.at(new Date(now)) },
        firebase: { initializeApp() {}, firestore },
        document: {
            hidden: false, getElementById: element,
            querySelectorAll: () => [],
            addEventListener: (name, fn) => { events[name] = fn; },
        },
        window: { addEventListener: (name, fn) => { events[name] = fn; } },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        addEventListener() {}, messages,
    });
    vm.runInContext(source, context);
    vm.runInContext(`
        renderRules = () => {};
        updateCountHint = () => {};
        renderPlan = plan => { currentPlan = plan; };
        toast = message => messages.push(message);
        scheduleStarted = true;
    `, context);
    return { context, elements, element, storage, reads, writes, events, messages,
        tick(time) { now = time; context.syncClassWithSchedule(); },
        get(expression) { return vm.runInContext(expression, context); },
    };
}

test('앱을 열면 현재 수업을 선택하고 해당 반의 명단을 불러온다', () => {
    const a = app();
    a.storage.set('classroom_seats_class_6-3-과학', '1 테스트학생');
    a.context.syncClassWithSchedule(true);
    assert.equal(a.element('classSelect').value, '6-3-과학');
    assert.equal(a.element('maleInput').value, '1 테스트학생');
    assert.match(a.element('scheduleStatus').textContent, /지금은 4교시 · 6-3-과학/);
    assert.equal(a.get('loadedClass'), '6-3-과학');
});

test('쉬는 시간에는 다음 반을 미리 선택하고 같은 반은 다시 불러오지 않는다', () => {
    const a = app({ now: '2026-10-28T09:30:00+09:00' });
    a.context.syncClassWithSchedule(true);
    const version = a.get('classLoadVersion');
    assert.equal(a.element('classSelect').value, '3-3-영어');
    assert.match(a.element('scheduleStatus').textContent, /다음은 2교시/);
    a.tick('2026-10-28T09:40:00+09:00');
    assert.equal(a.get('classLoadVersion'), version);
    assert.match(a.element('scheduleStatus').textContent, /지금은 2교시/);
    a.tick('2026-10-28T10:20:00+09:00');
    assert.equal(a.element('classSelect').value, '4-2-영어');
});

test('반 직접 선택·편집 중에는 전환을 멈추고 버튼으로 자동 선택을 재개한다', () => {
    const a = app();
    a.context.syncClassWithSchedule(true);
    a.element('classSelect').value = '4-1-영어';
    a.context.onManualClassChange();
    a.tick('2026-10-28T08:50:00+09:00');
    assert.equal(a.element('classSelect').value, '4-1-영어');
    assert.equal(a.element('resumeAutoClassBtn').hidden, false);
    a.context.resumeAutoClass();
    assert.equal(a.element('classSelect').value, '3-4-영어');
    a.context.pauseAutoClass('edit');
    a.element('maleInput').value = '51 수정 중';
    a.tick('2026-10-28T09:40:00+09:00');
    assert.equal(a.element('classSelect').value, '3-4-영어');
    assert.equal(a.element('maleInput').value, '51 수정 중');
    assert.match(a.element('scheduleStatus').textContent, /편집 중/);
});

test('탭으로 복귀하면 즉시 현재 시간표로 갱신한다', () => {
    const a = app();
    a.context.syncClassWithSchedule(true);
    a.context.pauseAutoClass();
    a.tick('2026-10-28T08:50:00+09:00');
    a.get('autoClassEnabled = true');
    a.events.visibilitychange();
    assert.equal(a.element('classSelect').value, '3-4-영어');
    assert.equal(typeof a.events.focus, 'function');
    assert.equal(typeof a.events.pageshow, 'function');
});

test('주말에는 마지막으로 선택한 반을 유지하며 수업 중으로 표시하지 않는다', () => {
    const a = app({ now: '2026-10-31T10:30:00+09:00' });
    a.storage.set('classroom_seats_last_class', '5-2-과학');
    a.context.syncClassWithSchedule(true);
    assert.equal(a.element('classSelect').value, '5-2-과학');
    assert.match(a.element('scheduleStatus').textContent, /예정된 수업이 없어요/);
});

test('반을 연속으로 바꾸어도 이전 반의 늦은 응답이 최신 명단을 덮지 않는다', async () => {
    const a = app({ online: true });
    const oldLoad = a.context.changeClass();
    a.element('classSelect').value = '6-3-과학';
    const newLoad = a.context.changeClass();
    a.reads[2].resolve(snapshot({ studentList: '1 최신반' }));
    a.reads[3].resolve(snapshot(null));
    await newLoad;
    assert.equal(a.element('maleInput').value, '1 최신반');
    a.reads[0].resolve(snapshot({ studentList: '51 이전반' }));
    a.reads[1].resolve(snapshot(null));
    await oldLoad;
    assert.equal(a.element('maleInput').value, '1 최신반');
    assert.equal(a.get('loadedClass'), '6-3-과학');
});

test('명단을 읽는 동안에는 이전 배치를 다른 반에 저장할 수 없다', async () => {
    const a = app({ online: true });
    const load = a.context.changeClass();
    await a.context.saveCurrentList();
    await a.context.savePlan();
    assert.equal(a.writes.length, 0);
    assert.equal(a.element('saveBtn').disabled, true);
    a.reads.forEach(read => read.resolve(snapshot(null)));
    await load;
    assert.equal(a.element('saveBtn').disabled, false);
});

test('저장 도중 반이 바뀌어도 명단과 규칙은 저장을 누른 반에 함께 기록한다', async () => {
    const a = app({ online: true });
    const load = a.context.changeClass();
    a.reads.forEach(read => read.resolve(snapshot(null)));
    await load;
    a.element('maleInput').value = '51 테스트학생';
    a.get("currentRules = [{type:'front', a:'51'}]");
    const save = a.context.saveCurrentList();
    a.element('classSelect').value = '6-3-과학';
    a.get("currentRules[0].a = '1'");
    a.writes.forEach(write => write.resolve());
    await save;
    await flush();
    assert.deepEqual(a.writes.map(write => write.id), ['3-3-영어', '3-3-영어__plan']);
    assert.equal(a.writes[1].data.rules[0].a, '51');
});
