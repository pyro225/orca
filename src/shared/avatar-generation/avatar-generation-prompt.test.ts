import { describe, expect, it } from 'vitest'
import { avatarGenerationPrompt, describesRealPerson } from './avatar-generation-prompt'

describe('describesRealPerson', () => {
  it.each([
    'me as a superhero',
    'my wife riding a dragon',
    'a photo of Taylor Swift',
    'the president in a spacesuit',
    'someone who looks like Keanu Reeves'
  ])('turns away %s', (description) => {
    expect(describesRealPerson(description)).toBe(true)
  })

  it.each([
    'a friendly orange fox astronaut',
    'a robot owl wizard with a Glowing Staff',
    'pixel art cat wearing a crown'
  ])('allows %s', (description) => {
    expect(describesRealPerson(description)).toBe(false)
  })
})

describe('avatarGenerationPrompt', () => {
  it('keeps the subject on one line inside the wrapper', () => {
    const prompt = avatarGenerationPrompt('  a fox\nastronaut  ')
    expect(prompt).toContain('Subject: a fox astronaut ')
    expect(prompt).not.toContain('\n')
  })
})
