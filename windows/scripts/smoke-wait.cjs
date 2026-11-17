/** Poll asynchronous IPC state from Node; do not treat its Promise as a DOM predicate. */
async function waitForAsync(page,predicate,arg,options={}) {
  const deadline=Date.now()+(options.timeout??15000);
  do {
    if(await page.evaluate(predicate,arg))return;
    await page.waitForTimeout(options.polling??30);
  }while(Date.now()<deadline);
  throw new Error('Asynchronous application condition did not become true');
}
module.exports={waitForAsync};
