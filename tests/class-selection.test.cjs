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
    assert.equal(a.element('layoutSelect').value, 'science');
    assert.equal(a.get('currentPlan.layout'), 'science');
});

test('쉬는 시간에는 다음 반을 미리 선택하고 같은 반은 다시 불러오지 않는다', () => {
    const a = app({ now: '2026-10-28T09:30:00+09:00' });
    a.context.syncClassWithSchedule(true);
    const version = a.get('classLoadVersion');
    assert.equal(a.element('classSelect').value, '3-3-영어');
    assert.match(a.element('scheduleStatus').textContent, /다음은 2교시/);
    assert.equal(a.element('layoutSelect').value, 'zigzag');
    assert.equal(a.get('currentPlan.layout'), 'zigzag');
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

test('과학 수업에서 다음 영어 수업으로 넘어가면 교실 모양도 함께 바뀐다', () => {
    const a = app({ now: '2026-10-29T11:09:00+09:00' });
    a.context.syncClassWithSchedule(true);
    assert.equal(a.element('classSelect').value, '5-2-과학');
    assert.equal(a.get('currentPlan.layout'), 'science');
    a.tick('2026-10-29T11:10:00+09:00');
    assert.equal(a.element('classSelect').value, '3-3-영어');
    assert.equal(a.get('currentPlan.layout'), 'zigzag');
});

test('다른 모양의 저장 배치는 자동 선택을 덮지 않으며 기존 저장본은 보관한다', () => {
    for (const [now, cls, expected] of [
        ['2026-10-27T11:39:00+09:00', '6-3-과학', 'science'],
        ['2026-10-28T08:50:00+09:00', '3-4-영어', 'zigzag'],
    ]) {
        const a = app({ now });
        const original = JSON.stringify({ layout: 'free', seats: [{ n: '1 이전배치', g: 'male', f: 'up' }] });
        a.storage.set(`classroom_seats_plan_${cls}`, original);
        a.storage.set(`classroom_seats_class_${cls}`, '1 현재명단');
        a.context.syncClassWithSchedule(true);
        assert.equal(a.element('layoutSelect').value, expected);
        assert.equal(a.get('currentPlan.layout'), expected);
        assert.equal(a.get('flatSeats(currentPlan).filter(s => s.name)[0].name'), '1 현재명단');
        assert.equal(a.get('savedPlanRaw.layout'), 'free');
        assert.equal(a.storage.get(`classroom_seats_plan_${cls}`), original);
        assert.equal(a.element('loadPlanBtn').disabled, false);
        assert.equal(a.writes.length, 0);
    }
});

test('과목과 같은 교실 모양으로 저장된 자리·빈자리·방향은 그대로 복원한다', () => {
    for (const [now, cls, layout, count] of [
        ['2026-10-27T11:39:00+09:00', '6-3-과학', 'science', 4],
        ['2026-10-28T08:50:00+09:00', '3-4-영어', 'zigzag', 20],
    ]) {
        const a = app({ now });
        const seats = Array.from({ length: count }, () => ({ n: '', g: '', f: 'up' }));
        seats[count - 1] = { n: '1 저장학생', g: 'female', f: 'down' };
        a.storage.set(`classroom_seats_plan_${cls}`, JSON.stringify({ layout, seats }));
        a.context.syncClassWithSchedule(true);
        const restored = a.get('flatSeats(currentPlan)');
        assert.equal(restored.length, count);
        assert.equal(restored[0].name, '');
        assert.equal(restored[count - 1].name, '1 저장학생');
        assert.equal(restored[count - 1].face, 'down');
        const version = a.get('classLoadVersion');
        a.context.syncClassWithSchedule();
        assert.equal(a.get('classLoadVersion'), version);
    }
});

test('같은 반에서도 자동 선택을 다시 켜면 과목의 모양으로 복귀한다', () => {
    const a = app();
    a.context.syncClassWithSchedule(true);
    a.element('layoutSelect').value = 'free';
    a.context.shuffleAndRender();
    a.context.syncClassWithSchedule();
    assert.equal(a.get('currentPlan.layout'), 'free');
    a.context.resumeAutoClass();
    assert.equal(a.element('classSelect').value, '6-3-과학');
    assert.equal(a.element('layoutSelect').value, 'science');
    assert.equal(a.get('currentPlan.layout'), 'science');
});

test('수동으로 반을 선택하면 이전처럼 그 반의 저장 모양을 불러온다', async () => {
    const a = app();
    const seats = Array.from({ length: 8 }, () => ({ n: '', g: '', f: 'up' }));
    a.storage.set('classroom_seats_plan_3-3-영어', JSON.stringify({ layout: 'free', seats }));
    a.context.onManualClassChange();
    await flush();
    assert.equal(a.element('layoutSelect').value, 'free');
    assert.equal(a.get('currentPlan.layout'), 'free');
    assert.equal(a.get('autoClassEnabled'), false);
});

test('지그재그 정원을 넘으면 저장 모양 안내보다 미배치 학생 경고를 유지한다', () => {
    const a = app({ now: '2026-10-28T08:50:00+09:00' });
    a.storage.set('classroom_seats_plan_3-4-영어', JSON.stringify({ layout: 'free', seats: [{ n: '', g: '', f: 'up' }] }));
    a.storage.set('classroom_seats_class_3-4-영어', Array.from({ length: 21 }, (_, i) => `${i + 1} 테스트학생`).join('\n'));
    a.context.syncClassWithSchedule(true);
    assert.equal(a.get('currentPlan.layout'), 'zigzag');
    assert.match(a.messages.at(-1), /1명이 앉지 못했어요/);
});
