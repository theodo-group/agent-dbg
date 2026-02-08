export interface Variable {
	ref: string;
	name: string;
	value: string;
}

export function formatVariables(vars: Variable[]): string {
	if (vars.length === 0) return "";

	const maxRefLen = Math.max(...vars.map((v) => v.ref.length));
	const maxNameLen = Math.max(...vars.map((v) => v.name.length));

	return vars
		.map((v) => {
			const ref = v.ref.padEnd(maxRefLen);
			const name = v.name.padEnd(maxNameLen);
			return `${ref}  ${name}  ${v.value}`;
		})
		.join("\n");
}
