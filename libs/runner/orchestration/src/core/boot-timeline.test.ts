import {createBootTimelineCollector, createRunnerBootPhaseTimeline} from '#core/boot-timeline.js';

function systemdStat(startTicks: number): string {
  return `1 (systemd) S ${Array.from({length: 18}, () => '0').join(' ')} ${startTicks}`;
}

describe('boot timeline collection', () => {
  it('builds the boot and runner read breakdown from monotonic samples', () => {
    const files: Record<string, string> = {
      '/proc/uptime': '42.5 0.0',
      '/run/shipfox/boot-io':
        'root_device=nvme0n1\nread_ops=100\nread_sectors=200\nuptime_seconds=35.5\n',
      '/sys/block/nvme0n1/stat': '120 0 220 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      '/proc/self/stat': systemdStat(4000),
      '/proc/1/stat': systemdStat(100),
      '/etc/shipfox/image-revision': '0123456789abcdef0123456789abcdef01234567\n',
    };
    const read = vi.fn((path: string) => files[path]);
    const collector = createBootTimelineCollector(read);

    files['/proc/uptime'] = '60.5 0.0';
    files['/sys/block/nvme0n1/stat'] = '150 0 250 0 0 0 0 0 0 0 0 0 0 0 0 0 0';
    const event = collector.createEvent(collector.captureEnrollment());

    expect(event).toEqual({
      boot_timeline_version: 1,
      telemetry_state: 'complete',
      uptime_seconds: 42.5,
      process_start_offset_seconds: 40,
      enrollment_offset_seconds: 60.5,
      kernel_seconds: 1,
      userspace_seconds: 39,
      image_revision: '0123456789abcdef0123456789abcdef01234567',
      boot_read_bytes: 102_400,
      boot_read_ops: 100,
      boot_read_bytes_per_second: 102_400 / 35.5,
      runner_read_bytes: 15_360,
      runner_read_ops: 30,
      runner_read_bytes_per_second: 15_360 / 20.5,
    });
  });

  it('records each runner phase once from a monotonic clock', () => {
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(11)
      .mockReturnValueOnce(12)
      .mockReturnValueOnce(13)
      .mockReturnValueOnce(14);
    const timeline = createRunnerBootPhaseTimeline(now);

    timeline.mark('runner_started_offset_seconds');
    timeline.mark('runner_started_offset_seconds');
    timeline.mark('bootstrap_exchange_offset_seconds');
    timeline.mark('activation_offset_seconds');
    timeline.mark('first_claim_offset_seconds');

    expect(timeline.snapshot()).toEqual({
      process_entry_offset_seconds: 10,
      runner_started_offset_seconds: 11,
      bootstrap_exchange_offset_seconds: 12,
      activation_offset_seconds: 13,
      first_claim_offset_seconds: 14,
    });
    expect(now).toHaveBeenCalledTimes(5);
  });

  it('keeps the event useful when an older image has no telemetry files', () => {
    const files: Record<string, string> = {'/proc/uptime': '12.25 0.0'};
    const collector = createBootTimelineCollector((path) => files[path]);

    expect(collector.createEvent(collector.captureEnrollment())).toEqual({
      boot_timeline_version: 1,
      telemetry_state: 'unavailable',
      uptime_seconds: 12.25,
      process_start_offset_seconds: 12.25,
      enrollment_offset_seconds: 12.25,
    });
  });
});
