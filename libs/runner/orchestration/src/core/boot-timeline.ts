import {readFileSync} from 'node:fs';

const BOOT_IO_PATH = '/run/shipfox/boot-io';
const IMAGE_REVISION_PATH = '/etc/shipfox/image-revision';
const PROCESS_STAT_PATH = '/proc/self/stat';
const SYSTEMD_STAT_PATH = '/proc/1/stat';
const UPTIME_PATH = '/proc/uptime';
const SYSTEM_CLOCK_TICKS_PER_SECOND = 100;
const ROOT_DEVICE_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const WHITESPACE_PATTERN = /\s+/u;

type ReadText = (path: string) => string | undefined;

type DiskReadSample = {
  readOps: number;
  readSectors: number;
};

type BootIoSample = DiskReadSample & {
  rootDevice: string;
  uptimeSeconds: number;
};

type EnrollmentSample = {
  currentDiskReads?: DiskReadSample;
  uptimeSeconds?: number;
};

export type BootTimelineFields = Record<string, number | string>;

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function parseNonNegativeNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseUptime(raw: string | undefined): number | undefined {
  return parseNonNegativeNumber(raw?.trim().split(WHITESPACE_PATTERN)[0]);
}

function parseKeyValueFile(raw: string | undefined): Record<string, string> {
  if (raw === undefined) return {};

  return Object.fromEntries(
    raw
      .split('\n')
      .map((line) => line.split('='))
      .filter(([key, value]) => key !== undefined && value !== undefined)
      .map(([key, ...value]) => [key, value.join('=')]),
  );
}

function parseDiskReadSample(raw: string | undefined): DiskReadSample | undefined {
  const fields = raw?.trim().split(WHITESPACE_PATTERN);
  if (!fields || fields.length < 3) return undefined;

  const readOps = parseNonNegativeNumber(fields[0]);
  const readSectors = parseNonNegativeNumber(fields[2]);
  if (readOps === undefined || readSectors === undefined) return undefined;

  return {readOps, readSectors};
}

function parseBootIoSample(raw: string | undefined): BootIoSample | undefined {
  const values = parseKeyValueFile(raw);
  const rootDevice = values.root_device;
  const readOps = parseNonNegativeNumber(values.read_ops);
  const readSectors = parseNonNegativeNumber(values.read_sectors);
  const uptimeSeconds = parseNonNegativeNumber(values.uptime_seconds);
  if (
    rootDevice === undefined ||
    !ROOT_DEVICE_PATTERN.test(rootDevice) ||
    readOps === undefined ||
    readSectors === undefined ||
    uptimeSeconds === undefined
  ) {
    return undefined;
  }

  return {rootDevice, readOps, readSectors, uptimeSeconds};
}

function parseProcessStartSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;

  const commandEnd = raw.lastIndexOf(')');
  if (commandEnd < 0) return undefined;

  const fields = raw
    .slice(commandEnd + 1)
    .trim()
    .split(WHITESPACE_PATTERN);
  const startTicks = parseNonNegativeNumber(fields[19]);
  return startTicks === undefined ? undefined : startTicks / SYSTEM_CLOCK_TICKS_PER_SECOND;
}

function setField(
  fields: BootTimelineFields,
  key: string,
  value: number | string | undefined,
): void {
  if (value !== undefined) fields[key] = value;
}

function readImageRevision(read: ReadText): string | undefined {
  const bakedRevision = read(IMAGE_REVISION_PATH)?.trim();
  if (bakedRevision) return bakedRevision;

  const environmentRevision = process.env.IMAGE_REVISION?.trim();
  return environmentRevision || undefined;
}

function readEnrollmentSample(read: ReadText): EnrollmentSample {
  const uptimeSeconds = parseUptime(read(UPTIME_PATH));
  const bootIo = parseBootIoSample(read(BOOT_IO_PATH));
  const currentDiskReads =
    bootIo === undefined
      ? undefined
      : parseDiskReadSample(read(`/sys/block/${bootIo.rootDevice}/stat`));

  return {
    ...(currentDiskReads === undefined ? {} : {currentDiskReads}),
    ...(uptimeSeconds === undefined ? {} : {uptimeSeconds}),
  };
}

function readBootIo(read: ReadText): BootIoSample | undefined {
  return parseBootIoSample(read(BOOT_IO_PATH));
}

function addReadFields(
  fields: BootTimelineFields,
  processStartSeconds: number | undefined,
  enrollment: EnrollmentSample,
  bootIo: BootIoSample | undefined,
): void {
  if (bootIo === undefined) return;

  const bootReadBytes = bootIo.readSectors * 512;
  setField(fields, 'boot_read_bytes', bootReadBytes);
  setField(fields, 'boot_read_ops', bootIo.readOps);

  if (processStartSeconds !== undefined && processStartSeconds > 0) {
    setField(fields, 'boot_read_bytes_per_second', bootReadBytes / processStartSeconds);
  }

  const current = enrollment.currentDiskReads;
  if (current === undefined) return;

  const runnerReadBytes = Math.max(0, current.readSectors - bootIo.readSectors) * 512;
  const runnerReadOps = Math.max(0, current.readOps - bootIo.readOps);
  setField(fields, 'runner_read_bytes', runnerReadBytes);
  setField(fields, 'runner_read_ops', runnerReadOps);

  const runnerDurationSeconds =
    processStartSeconds !== undefined && enrollment.uptimeSeconds !== undefined
      ? enrollment.uptimeSeconds - processStartSeconds
      : undefined;
  if (runnerDurationSeconds !== undefined && runnerDurationSeconds > 0) {
    setField(fields, 'runner_read_bytes_per_second', runnerReadBytes / runnerDurationSeconds);
  }
}

export function createBootTimelineCollector(read: ReadText = readText) {
  const processStartUptimeSeconds = parseUptime(read(UPTIME_PATH));
  const processStartOffsetSeconds =
    parseProcessStartSeconds(read(PROCESS_STAT_PATH)) ?? processStartUptimeSeconds;

  return {
    captureEnrollment(): EnrollmentSample {
      return readEnrollmentSample(read);
    },

    createEvent(enrollment: EnrollmentSample): BootTimelineFields {
      const fields: BootTimelineFields = {};
      const systemdStartSeconds = parseProcessStartSeconds(read(SYSTEMD_STAT_PATH));

      setField(fields, 'uptime_seconds', processStartUptimeSeconds);
      setField(fields, 'process_start_offset_seconds', processStartOffsetSeconds);
      setField(fields, 'enrollment_offset_seconds', enrollment.uptimeSeconds);
      setField(fields, 'kernel_seconds', systemdStartSeconds);
      setField(
        fields,
        'userspace_seconds',
        processStartOffsetSeconds !== undefined && systemdStartSeconds !== undefined
          ? Math.max(0, processStartOffsetSeconds - systemdStartSeconds)
          : undefined,
      );
      setField(fields, 'image_revision', readImageRevision(read));
      addReadFields(fields, processStartOffsetSeconds, enrollment, readBootIo(read));

      return fields;
    },
  };
}
