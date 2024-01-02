import { promises } from "fs";

const ITERATIONS = 100;
const REQUESTS_PER_ITERATION = 10;
const TIMER_LABEL = `Time for ${ITERATIONS * REQUESTS_PER_ITERATION} orders.`

const config = (await promises.readFile("./config.json", "utf8"));

const { InventoryUrl, OrdersUrl } = JSON.parse(config).WimsStack;

const responses = {};
let totalSales = 0;

const startInventory = (await (await fetch(InventoryUrl)).json()).quantity;
console.log(`Starting Inventory: ${startInventory}`);

console.time(TIMER_LABEL);
for (let i = 0; i < ITERATIONS; i++) {
  const promises = [];
  for (let j = 0; j < REQUESTS_PER_ITERATION; j++) {
    const quantity = Math.floor(Math.random() * 10) + 1;
    totalSales += quantity;
    promises.push(await fetch(OrdersUrl, {
      body: JSON.stringify({ customerId: Math.floor(Math.random() * 1000).toString(), quantity }),
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
const nextTickInventory = (await (await fetch(InventoryUrl)).json()).quantity;
console.log(`Inventory at next tick: ${nextTickInventory}`);
console.log(`Inventory reduced by: ${startInventory - nextTickInventory} of sales total ${totalSales}.`);
console.timeEnd(TIMER_LABEL);
console.log(responses);
setTimeout(async () => {
  const finalInventory = (await (await fetch(InventoryUrl)).json()).quantity;
  console.log(`Inventory after 500ms: ${finalInventory}`);
  console.log(`Inventory reduced by: ${startInventory - finalInventory} of sales total ${totalSales}.`);
  console.log('Waited 500 ms.');
}, 500);
