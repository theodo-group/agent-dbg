console.log("hello from app");
console.warn("warning message");
console.error("error message");
const obj = { key: "value" };
console.log("object:", obj);
try { throw new Error("test error"); } catch(e) { /* swallowed */ }
debugger;
console.log("after debugger");
