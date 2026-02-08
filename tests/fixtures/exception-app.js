// This script throws an uncaught exception after a short delay.
// The process will crash, but the Runtime.exceptionThrown event
// will be captured before the process exits.
setTimeout(() => {
	throw new Error("uncaught!");
}, 50);
