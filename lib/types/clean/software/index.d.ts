/**
 * 软件搬家的对外出口：服务层只从这里引用。
 *
 * 只做转出，不放逻辑。列表与判定在 ./list，搬家与还原在 ./mover，系统探针在 ./probe，提权脚本在 ./script。
 * @module jingsao/src/host/clean/software
 */
export { listSoftware, SOFTWARE_MIN_SIZE, type ListSoftwareOptions } from './list.ts';
export { SoftwareMover, type MoverOps, type SoftwareMoverOptions, type SoftwareRunOptions } from './mover.ts';
export { realSoftwareProbe, type InstalledApp, type SoftwareProbe } from './probe.ts';
export { realElevatedRunner, type ElevatedRequest, type ElevatedResult, type ElevatedRunner } from './script.ts';
