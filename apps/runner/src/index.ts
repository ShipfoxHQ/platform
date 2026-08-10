const processEntryUptimeSeconds = process.uptime();
const [{logger}, {startRunner}] = await Promise.all([
  import('@shipfox/node-opentelemetry'),
  import('@shipfox/runner-orchestration'),
]);

try {
  await startRunner({processEntryUptimeSeconds});
} catch (error) {
  logger().error({error}, 'Fatal runner error');
  process.exit(1);
}
