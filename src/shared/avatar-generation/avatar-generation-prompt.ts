// The words around a user's avatar description, and the check that turns away real people first.

const REAL_PERSON_PATTERNS: readonly RegExp[] = [
  /\b(me|myself|my face|my photo|my picture|my selfie|selfie)\b/i,
  /\b(my|our) (wife|husband|partner|boyfriend|girlfriend|son|daughter|kid|child|mom|mother|dad|father|brother|sister|friend|boss|coworker|colleague)\b/i,
  /\b(real|actual) (person|people|human)\b/i,
  /\b(photo|photograph|likeness|portrait) of [A-Z][a-z]+ [A-Z][a-z]+/,
  /\b(celebrity|celebrities|politician|president|prime minister|senator|governor|pope|king of|queen of|ceo of|influencer|youtuber|streamer)\b/i,
  /\b(looks? like|resembl\w*|in the style of the face of) [A-Z][a-z]+ [A-Z][a-z]+/
]

/** Whether a description asks for a real, identifiable person; checked before any agent runs. */
export function describesRealPerson(description: string): boolean {
  return REAL_PERSON_PATTERNS.some((pattern) => pattern.test(description))
}

/** One line, so the prompt survives argv on every platform. */
export function avatarGenerationPrompt(description: string): string {
  const subject = description.replace(/\s+/g, ' ').trim()
  return [
    'Use your image generation tool to create exactly one image, then stop.',
    'It is a profile avatar for an AI assistant in a chat app, shown small and cropped to a circle, so it must read instantly at thumbnail size.',
    `Subject: ${subject}`,
    'Make it a square 1:1 image with the subject centered and filling most of the frame, on a simple uncluttered background that runs to the edges.',
    'Use a stylized character illustration with bold readable shapes and a limited palette, unless the subject names another art style.',
    'Do not draw a circle, badge, border or frame. No text, letters, logos, watermarks or interface elements.',
    'Never depict a real, identifiable person, including public figures; if the subject asks for one, make no image and reply REFUSED.',
    'Do not run shell commands or edit files.'
  ].join(' ')
}
