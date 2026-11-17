/**
 * 重复文件的对外出口：服务层只从这里引用。
 *
 * 只做转出，不放逻辑；扫描与选择检查都在 ./scan。删除走直接删除流程（../delete），不在这里。
 * @module jingsao/src/host/clean/duplicates
 */
export { scanDuplicates, checkDuplicateSelection, DUPLICATE_MIN_SIZE, DUPLICATE_MAX_GROUPS, type DupCandidate, type DuplicateScanOptions, } from './scan.ts';
