const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../v2/schedule.js');
const at = (day, time) => schedule.at(new Date(`2026-10-${day}T${time}:00+09:00`));

test('제공된 주간 시간표의 19차시와 과목이 일치한다', () => {
    const expected = [
        [],
        [[3, '6-1-과학'], [4, '6-1-과학']],
        [[3, '6-3-과학'], [4, '6-3-과학']],
        [[1, '3-4-영어'], [2, '3-3-영어'], [3, '4-2-영어'], [4, '4-1-영어'], [5, '4-3-영어']],
        [[1, '5-3-과학'], [2, '5-1-과학'], [3, '5-2-과학'], [4, '3-3-영어'], [5, '3-4-영어']],
        [[1, '4-1-영어'], [2, '4-2-영어'], [3, '4-3-영어'], [4, '6-2-과학'], [5, '6-2-과학']],
        [],
    ];
    assert.deepEqual(expected.map((_, day) => schedule.lessonsForDay(day).map(x => [x.period, x.classId])), expected);
    assert.equal(expected.flat().length, 19);
});

test('19개 수업의 시작은 포함하고 종료 시각은 포함하지 않는다', () => {
    for (let weekday = 1; weekday <= 5; weekday++) {
        const day = 25 + weekday;
        for (const lesson of schedule.lessonsForDay(weekday)) {
            const start = new Date(`2026-10-${day}T${lesson.start}:00+09:00`);
            const end = new Date(`2026-10-${day}T${lesson.end}:00+09:00`);
            assert.equal(schedule.at(start).current.classId, lesson.classId);
            assert.equal(schedule.at(new Date(end - 1)).current.period, lesson.period);
            assert.equal(schedule.at(end).current, null);
            assert.equal(schedule.at(new Date(start - 1)).current, null);
        }
    }
});

test('4교시는 3학년 12:00~12:40, 4~6학년 11:20~12:00', () => {
    assert.equal(at(29, '11:20').current, null);
    assert.equal(at(29, '11:20').next.classId, '3-3-영어');
    assert.equal(at(29, '12:00').current.classId, '3-3-영어');
    assert.equal(at(29, '12:39').current.period, 4);
    assert.equal(at(29, '12:40').current, null);
    for (const day of [26, 27, 28, 30]) {
        assert.equal(at(day, '11:20').current.period, 4);
        assert.equal(at(day, '11:59').current.period, 4);
        assert.equal(at(day, '12:00').current, null);
    }
});

test('쉬는 시간·공강·등교 전에는 현재 수업과 다음 수업을 구별한다', () => {
    for (const time of ['07:00', '09:00', '10:29']) {
        const state = at(26, time);
        assert.equal(state.current, null);
        assert.equal(state.next.classId, '6-1-과학');
        assert.equal(state.next.start, '10:30');
    }
    assert.equal(at(28, '09:30').next.classId, '3-3-영어');
    assert.equal(at(28, '12:00').next.classId, '4-3-영어');
    assert.equal(at(30, '12:50').current.classId, '6-2-과학');
});

test('방과 후·주말에는 없는 수업을 현재 수업으로 표시하지 않는다', () => {
    for (const [day, time] of [[26, '12:00'], [27, '18:00'], [28, '13:30'], [29, '13:40'], [30, '23:59'], [31, '10:30'], [25, '11:20']]) {
        assert.equal(at(day, time).current, null);
        assert.equal(at(day, time).next, null);
    }
});

test('기기 시간대와 무관하게 한국 시간과 한국 요일로 판단한다', () => {
    const state = schedule.at(new Date('2026-10-27T02:39:00Z'));
    assert.equal(state.current.classId, '6-3-과학');
    assert.equal(state.current.period, 4);
    assert.equal(state.timeLabel, '11:39');
    assert.equal(state.dateLabel, '10월 27일 (화)');
    const midnight = schedule.at(new Date('2026-10-25T15:00:00Z'));
    assert.equal(midnight.weekday, 1);
    assert.equal(midnight.dateKey, '2026-10-26');
    assert.equal(midnight.timeLabel, '00:00');
});
