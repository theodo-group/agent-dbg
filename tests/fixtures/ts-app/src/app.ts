// TypeScript test fixture for source map integration tests
interface Person {
	name: string;
	age: number;
}

function greet(person: Person): string {
	const message: string = `Hello, ${person.name}! Age: ${person.age}`;
	return message;
}

function add(a: number, b: number): number {
	const result: number = a + b;
	return result;
}

const alice: Person = { name: "Alice", age: 30 };
const greeting: string = greet(alice);
const sum: number = add(2, 3);
console.log(greeting);
console.log("Sum:", sum);
