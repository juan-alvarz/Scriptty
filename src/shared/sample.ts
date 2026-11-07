/** First file in a new workspace. */
export const SAMPLE = `// Results update as you type. Try editing a number.
interface User { name: string; age: number }

const users: User[] = [
  { name: "Ada", age: 36 },
  { name: "Linus", age: 28 },
  { name: "Grace", age: 45 },
]

users.length
users.map(u => u.name)
users.filter(u => u.age > 30).length

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
avg(users.map(u => u.age)).toFixed(1)

console.log("oldest:", [...users].sort((a, b) => b.age - a.age)[0].name)

new Map(users.map(u => [u.name, u.age]))
await new Promise(r => setTimeout(() => r("resolved after 400ms"), 400))
`
