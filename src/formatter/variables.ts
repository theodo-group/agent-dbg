export interface Variable {
	ref: string;
	name: string;
	value: string;
	scope?: string;
}

const SCOPE_LABELS: Record<string, string> = {
	local: "Locals",
	module: "Module",
	closure: "Closure",
	block: "Block",
	catch: "Catch",
	script: "Script",
	eval: "Eval",
	with: "With",
	"wasm-expression-stack": "WASM Stack",
};

function formatGroup(vars: Variable[]): string {
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

export function formatVariables(vars: Variable[]): string {
	if (vars.length === 0) return "";

	// Collect unique scopes in order of appearance
	const scopeOrder: string[] = [];
	const groups = new Map<string, Variable[]>();
	for (const v of vars) {
		const scope = v.scope ?? "local";
		let group = groups.get(scope);
		if (!group) {
			group = [];
			scopeOrder.push(scope);
			groups.set(scope, group);
		}
		group.push(v);
	}

	// Single scope: no header needed
	if (scopeOrder.length === 1) {
		return formatGroup(vars);
	}

	// Multiple scopes: group with headers
	const sections: string[] = [];
	for (const scope of scopeOrder) {
		const group = groups.get(scope);
		if (!group || group.length === 0) continue;
		const label = SCOPE_LABELS[scope] ?? scope;
		sections.push(`${label}:\n${formatGroup(group)}`);
	}

	return sections.join("\n\n");
}
