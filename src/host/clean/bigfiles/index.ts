/**
 * 大文件搬家的对外出口：服务层只从这里引用。
 *
 * 只做转出，不放逻辑。扫描在 ./scan，搬家与还原在 ./store，目标检查在 ./destination。
 * @module jingsao/src/host/clean/bigfiles
 */
export { scanBigFiles, BIG_FILE_MIN_SIZE, type BigFileCandidate, type BigFileScanOptions } from './scan.ts';
export { MoveStore, type MoveStoreOptions, type MoveRunOptions } from './store.ts';
export { checkDestination, MOVE_DIR_NAME } from './destination.ts';
