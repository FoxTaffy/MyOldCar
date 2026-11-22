import { describe, expect, it } from 'vitest'
import { applySnapshot, backupName, backupsToDrop, collect, makeSnapshot, MARKER_KEY, needsRestore, parseSnapshot } from '@/services/DurableStore'
import { errorReport, pushError } from '@/services/ErrorLog'
import { safeFileName } from '@/services/FileSave'

class Mem {
  m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
}

describe('надёжное хранилище', () => {
  it('снимок берёт только ключи приложения и без служебных', () => {
    const st = new Mem()
    st.setItem(MARKER_KEY, '{"cars":[1]}')
    st.setItem('myoldcar.ui.v1', '{}')
    st.setItem('myoldcar.errors.v1', '[]')
    st.setItem('other.key', 'x')
    expect(Object.keys(collect(st)).sort()).toEqual([MARKER_KEY, 'myoldcar.ui.v1'])
  })

  it('восстановление — только когда машин нет, а в зеркале они есть', () => {
    const full = new Mem()
    full.setItem(MARKER_KEY, 'g')
    const snap = makeSnapshot(full, '0.9.0')
    const empty = new Mem()
    expect(needsRestore(empty, snap)).toBe(true)
    expect(needsRestore(full, snap)).toBe(false)
    expect(needsRestore(empty, null)).toBe(false)
    expect(applySnapshot(empty, snap)).toBe(1)
    expect(empty.getItem(MARKER_KEY)).toBe('g')
  })

  it('разбор копии отсеивает чужие файлы и посторонние ключи', () => {
    expect(() => parseSnapshot('not json')).toThrow(/повреждён/)
    expect(() => parseSnapshot('{"app":"x","data":{}}')).toThrow(/не копия/)
    expect(() => parseSnapshot('{"app":"myoldcar","data":{"evil":"1"}}')).toThrow(/нет данных/)
    const s = parseSnapshot(JSON.stringify({ app: 'myoldcar', version: '0.8.1', at: 'x', data: { 'myoldcar.a': '1', evil: '2', 'myoldcar.b': 3 } }))
    expect(s.data).toEqual({ 'myoldcar.a': '1' })
  })

  it('ротация автокопий оставляет 4 свежие', () => {
    const names = ['myoldcar-2026-01-01.json', 'myoldcar-2026-02-01.json', 'myoldcar-2026-03-01.json', 'myoldcar-2026-04-01.json', 'myoldcar-2026-05-01.json', 'notes.txt']
    expect(backupsToDrop(names)).toEqual(['myoldcar-2026-01-01.json'])
    expect(backupName(new Date('2026-11-22T10:00:00Z'))).toBe('myoldcar-2026-11-22.json')
  })
})

describe('журнал ошибок', () => {
  it('одинаковые ошибки подряд схлопываются, длина ограничена', () => {
    let l = pushError([], { at: 1, source: 'vue', message: 'boom' })
    l = pushError(l, { at: 2, source: 'vue', message: 'boom' })
    expect(l).toHaveLength(1)
    expect(l[0].count).toBe(2)
    for (let i = 0; i < 10; i++) l = pushError(l, { at: i, source: 'p', message: `e${i}` }, 5)
    expect(l).toHaveLength(5)
    expect(l[4].message).toBe('e9')
  })
  it('отчёт содержит версию и сообщения, новые сверху', () => {
    const t = errorReport([{ at: 0, source: 'vue', message: 'old', count: 1 }, { at: 1000, source: 'promise', message: 'new', count: 3, route: '/trip/1' }], '0.9.0', 'UA')
    expect(t).toMatch(/MyOldCar 0\.9\.0/)
    expect(t.indexOf('new')).toBeLessThan(t.indexOf('old'))
    expect(t).toMatch(/×3/)
  })
})

it('имя файла без запрещённых символов', () => {
  expect(safeFileName('ВАЗ 2104: поездка 12/05')).toBe('ВАЗ_2104_поездка_12_05')
})
