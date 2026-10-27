/* 매주 반복되는 수업 시간표. 날짜와 시각은 기기 설정과 관계없이 한국 기준이다. */
(function (root, factory) {
    const schedule = factory();
    if (typeof module === 'object' && module.exports) module.exports = schedule;
    else root.ClassSchedule = schedule;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 배열의 순서 = 1~6교시. 3~4학년은 영어, 5~6학년은 과학.
    const WEEK = [
        [],
        [null, null, '6-1', '6-1', null, null],
        [null, null, '6-3', '6-3', null, null],
        ['3-4', '3-3', '4-2', '4-1', '4-3', null],
        ['5-3', '5-1', '5-2', '3-3', '3-4', null],
        ['4-1', '4-2', '4-3', '6-2', '6-2', null],
        [],
    ];
    const PERIODS = [
        ['08:50', '09:30'], ['09:40', '10:20'], ['10:30', '11:10'],
        ['11:20', '12:00'], ['12:50', '13:30'], ['13:40', '14:20'],
    ];
    const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
    const clock = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const minutes = time => {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    };

    function lessonsForDay(weekday) {
        return (WEEK[weekday] || []).flatMap((room, index) => {
            if (!room) return [];
            const grade = Number(room.split('-')[0]);
            const [start, end] = index === 3 && grade <= 3
                ? ['12:00', '12:40'] : PERIODS[index];
            return [{
                classId: `${room}-${grade <= 4 ? '영어' : '과학'}`,
                period: index + 1, start, end,
                startMinute: minutes(start), endMinute: minutes(end),
            }];
        });
    }

    function at(date = new Date()) {
        const parts = Object.fromEntries(clock.formatToParts(date).map(p => [p.type, p.value]));
        const weekday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay();
        const minute = Number(parts.hour) * 60 + Number(parts.minute);
        const lessons = lessonsForDay(weekday);
        return {
            dateKey: `${parts.year}-${parts.month}-${parts.day}`,
            dateLabel: `${Number(parts.month)}월 ${Number(parts.day)}일 (${DAYS[weekday]})`,
            timeLabel: `${parts.hour}:${parts.minute}`,
            weekday, lessons,
            current: lessons.find(lesson => lesson.startMinute <= minute && minute < lesson.endMinute) || null,
            next: lessons.find(lesson => minute < lesson.startMinute) || null,
        };
    }

    return { at, lessonsForDay };
});
