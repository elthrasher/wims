import { promises } from "fs";

const ITERATIONS = 100;
const REQUESTS_PER_ITERATION = 10;
const TIMER_LABEL = `Time for ${ITERATIONS * REQUESTS_PER_ITERATION} orders.`

const config = (await promises.readFile("./config.json", "utf8"));

const url = JSON.parse(config).WimsStack.OrdersUrl;

const responses = {};

console.time(TIMER_LABEL);
for (let i = 0; i < ITERATIONS; i++) {
  const promises = [];
  for (let j = 0; j < REQUESTS_PER_ITERATION; j++) {
    promises.push(await fetch(url, {
      body: JSON.stringify({ customerId: Math.floor(Math.random() * 1000).toString(), quantity: Math.floor(Math.random() * 10) + 1 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    }));
  }
  const results = await Promise.all(promises);
  results.forEach(response => {
    const { status } = response;
    responses[status] = responses[status] ? responses[status] + 1 : 1;
  });
}
console.timeEnd(TIMER_LABEL);
console.log(responses);
