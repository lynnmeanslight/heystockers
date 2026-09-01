import { probeMagicBlockCompatibility, summarizeMagicBlockCompatibility } from '../src/magicblock'

const report = await probeMagicBlockCompatibility({ apiUrl: process.env.MAGICBLOCK_API_URL })
const assets = summarizeMagicBlockCompatibility(report.results)
const enabledAssets = assets.filter((asset) => asset.enabled).length

console.log(JSON.stringify({
  checkedAt: report.checkedAt,
  endpoint: process.env.MAGICBLOCK_API_URL ?? 'https://payments.magicblock.app',
  enabledAssets,
  totalAssets: assets.length,
  compatibleDirections: report.compatible,
  totalDirections: report.total,
  assets,
}, null, 2))

if (enabledAssets === 0) process.exitCode = 1