// Test fixture for execution control tests
// Each line is a separate statement for stepping tests

function helper(x) {
	const doubled = x * 2;
	return doubled;
}

const a = 1;
const b = 2;
const c = helper(a);
const d = a + b + c;
console.log(d);
