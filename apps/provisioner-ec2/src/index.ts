import {
  logger,
  shutdownInstrumentation,
  startInstanceInstrumentation,
  startServiceMetrics,
} from '@shipfox/node-opentelemetry';

try {
  await startInstanceInstrumentation({
    serviceName: 'provisioner-ec2',
    instrumentations: {
      fastify: false,
      http: true,
      undici: true,
      awsSdk: true,
      pino: true,
    },
  });
  startServiceMetrics({serviceName: 'provisioner-ec2'});

  const {startEc2Provisioner} = await import('@shipfox/provisioner-ec2-provider');
  await startEc2Provisioner();
} catch (error) {
  logger().error({error}, 'Fatal provisioner error');
  process.exitCode = 1;
} finally {
  await shutdownInstrumentation();
}
