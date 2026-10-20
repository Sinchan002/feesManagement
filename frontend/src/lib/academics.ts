/**
 * Class levels and subjects shown across the app come from the batches the teacher creates.
 * These lists are only suggestions in the batch editor (and the fallback before any batch exists).
 */
export const CLASS_SUGGESTIONS = [
  "Class 6",
  "Class 7",
  "Class 8",
  "Class 9",
  "Class 10",
  "Class 11",
  "Class 12",
  "Dropper",
  "UG",
  "PG",
]

export const SUBJECT_SUGGESTIONS = ["Physics", "Mathematics", "Chemistry", "Biology", "Science", "JEE", "NEET"]

type BatchLike = { classLevel: string; subjects: string[] }

/** Natural order: "Class 9" before "Class 10". */
const naturalSort = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })

const uniqueCaseInsensitive = (values: string[]) => {
  const seen = new Map<string, string>()
  for (const v of values.map((s) => s.trim()).filter(Boolean)) {
    if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v)
  }
  return [...seen.values()].sort(naturalSort)
}

/** Class levels that currently have a batch (falls back to the suggestions when there are none). */
export const classOptionsFrom = (batches: BatchLike[]) =>
  batches.length ? uniqueCaseInsensitive(batches.map((b) => b.classLevel)) : CLASS_SUGGESTIONS

/** Subjects taught in the given class's batches (or in all batches), with a fallback list. */
export function subjectOptionsFrom(batches: BatchLike[], classLevel?: string) {
  const inClass = classLevel ? batches.filter((b) => sameText(b.classLevel, classLevel)) : batches
  const subjects = uniqueCaseInsensitive(inClass.flatMap((b) => b.subjects))
  if (subjects.length) return subjects
  const all = uniqueCaseInsensitive(batches.flatMap((b) => b.subjects))
  return all.length ? all : SUBJECT_SUGGESTIONS
}

export const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
