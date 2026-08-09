import {createBootTimelineCollector} from '#core/boot-timeline.js';

function systemdStat(startTicks: number): string {
  return `1 (systemd) S ${Array.from({length: 18}, () => '0').join(' ')} ${startTicks}`;
}

describe('boot timeline collection', () => {
  it('builds the boot and runner read breakdown from monotonic samples', () => {
    const files: Record<string, string> = {
      '/proc/uptime': '42.5 0.0',
      '/run/shipfox/boot-io':
        'root_device=nvme0n1\nread_ops=100\nread_sectors=200\nuptime_seconds=35.5\n',
      '/sys/block/nvme0n1/stat': '150 0 250 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      '/proc/self/stat': systemdStat(4000),
      '/proc/1/stat': systemdStat(100),
      '/etc/shipfox/image-revision': '0123456789abcdef0123456789abcdef01234567\n',
    };
    const read = vi.fn((path: string) => files[path]);
    const collector = createBootTimelineCollector(read);

    files['/proc/uptime'] = '60.5 0.0';
    const event = collector.createEvent(collector.captureEnrollment());

    expect(event).toEqual({
      uptime_seconds: 42.5,
      process_start_offset_seconds: 40,
      enrollment_offset_seconds: 60.5,
      kernel_seconds: 1,
      userspace_seconds: 39,
      image_revision: '0123456789abcdef0123456789abcdef01234567',
      boot_read_bytes: 102_400,
      boot_read_ops: 100,
      boot_read_bytes_per_second: 102_400 / 35.5,
      runner_read_bytes: 25_600,
      runner_read_ops: 50,
      runner_read_bytes_per_second: 25_600 / 20.5,
    });
  });

  it('keeps the event useful when an older image has no telemetry files', () => {
    const files: Record<string, string> = {'/proc/uptime': '12.25 0.0'};
    const collector = createBootTimelineCollector((path) => files[path]);

    expect(collector.createEvent(collector.captureEnrollment())).toEqual({
      uptime_seconds: 12.25,
      process_start_offset_seconds: 12.25,
      enrollment_offset_seconds: 12.25,
    });
  });
});
