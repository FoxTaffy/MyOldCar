import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { handleBack, pushBack, resetBackForTests } from '../src/services/BackHandler'

const mk = () => createRouter({ history: createMemoryHistory(), routes: ['/', '/a', '/b'].map((path) => ({ path, component: { render: () => null } })) })

describe('системная кнопка «Назад»', () => {
  beforeEach(resetBackForTests)

  it('закрывает окно, пока оно открыто', async () => {
    const r = mk(); await r.push('/a')
    let closed = 0
    pushBack(() => { closed++ })
    expect(handleBack(r)).toBe('overlay')
    expect(closed).toBe(1)
  })
  it('на главной: первое нажатие предупреждает, второе выходит', async () => {
    const r = mk(); await r.push('/')
    let exited = 0
    expect(handleBack(r, 1000, () => { exited++ })).toBe('warn')
    expect(handleBack(r, 2500, () => { exited++ })).toBe('exit')
    expect(exited).toBe(1)
  })
  it('через 2 секунды счётчик сбрасывается', async () => {
    const r = mk(); await r.push('/')
    handleBack(r, 1000)
    expect(handleBack(r, 4000)).toBe('warn')
  })
  it('без истории на вложенном экране — на главную', async () => {
    const r = mk(); await r.push('/a')
    expect(handleBack(r)).toBe('home')
    await new Promise((res) => setTimeout(res, 10))
    expect(r.currentRoute.value.path).toBe('/')
  })
})
