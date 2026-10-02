const { planSchedule } = require('../../../plugins/wattanam.timetable/backend/generator');

describe('Timetable plugin generator', () => {
  const document = { numberOfDays: 5, periodsPerDay: 3, weekend: ['SATURDAY', 'SUNDAY'] };
  const lessons = [
    { id: 'l1', classId: 'c1', teacherId: 't1', subjectId: 's1', perWeek: 4 },
    { id: 'l2', classId: 'c2', teacherId: 't1', subjectId: 's2', perWeek: 4 },
  ];

  it('places lessons without class, teacher, or room collisions', () => {
    const plan = planSchedule(document, lessons, [{ id: 'r1' }, { id: 'r2' }]);
    expect(plan.complete).toBe(true);
    expect(plan.entries).toHaveLength(8);
    for (const dimension of ['classId', 'teacherId', 'classroomId']) {
      const occupied = plan.entries.map((entry: any) => `${entry[dimension]}:${entry.day}:${entry.period}`);
      expect(new Set(occupied).size).toBe(occupied.length);
    }
    expect(plan.entries.every((entry: any) => entry.day <= 5)).toBe(true);
  });

  it('reports unplaced lessons instead of silently publishing a partial schedule', () => {
    const plan = planSchedule({ ...document, periodsPerDay: 1 }, lessons, [{ id: 'r1' }]);
    expect(plan.complete).toBe(false);
    expect(plan.unplaced.length).toBeGreaterThan(0);
  });

  it('honors time-off periods and daily distribution limits deterministically', () => {
    const constrained = {
      ...document,
      periodTimes: ['07:00', '08:00', '09:00'],
      timeOffRules: [{ from: '08:00', to: '09:00' }],
      maxOnDay: 2,
      distribution: { maxSameSubjectPerDay: 1 },
    };
    const repeated = [
      { id: 'l1', classId: 'c1', teacherId: 't1', subjectId: 's1', perWeek: 3 },
      { id: 'l2', classId: 'c1', teacherId: 't2', subjectId: 's2', perWeek: 3 },
    ];
    const first = planSchedule(constrained, repeated, [{ id: 'r1' }, { id: 'r2' }]);
    const second = planSchedule(constrained, repeated, [{ id: 'r1' }, { id: 'r2' }]);
    expect(first).toEqual(second);
    expect(first.constraints).toEqual({ blockedPeriods: [2], maxOnDay: 2, maxSameSubjectPerDay: 1 });
    expect(first.entries.every((entry: any) => entry.period !== 2)).toBe(true);
    const perClassDay = first.entries.reduce((counts: Map<string, number>, entry: any) => counts.set(`${entry.classId}:${entry.day}`, (counts.get(`${entry.classId}:${entry.day}`) || 0) + 1), new Map());
    expect(Math.max(...perClassDay.values())).toBeLessThanOrEqual(2);
  });

  it('fails closed for malformed constraint configuration', () => {
    expect(() => planSchedule({ ...document, timeOffRules: [{ from: '12:00', to: '13:00' }] }, lessons)).toThrow('periodTimes are required');
    expect(() => planSchedule({ ...document, distribution: { maxSameSubjectPerDay: 0 } }, lessons)).toThrow('maxSameSubjectPerDay');
    expect(() => planSchedule({ ...document, periodTimes: ['bad', '08:00', '09:00'] }, lessons)).toThrow('HH:mm');
  });
});
