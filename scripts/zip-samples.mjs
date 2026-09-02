/**
 * 샘플 자료 묶음(ZIP) 갱신.
 *
 * 사장님 센터의 "전체 묶음 받기(ZIP)" 버튼이 이 파일을 내려주고,
 * 카드별 "샘플 다운로드"와 "샘플 자료 한 번에 올리기"는 개별 파일을 그대로 가져간다.
 * 두 경로가 다른 내용을 주면 같은 '샘플식당'인데 급여도 잔액도 달라져서
 * 교차검증이 거짓 불일치로 잡힌다. 그래서 CSV를 새로 만들든 문서를 새로 만들든
 * 반드시 이 단계를 거치도록 두 생성기에서 함께 호출한다.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const ZIP_NAME = 'meoktu-sample-pack.zip'

export async function rebuildSamplePack(outDir) {
  try {
    const entries = (await fs.readdir(outDir)).filter((name) => name !== ZIP_NAME).sort()
    await fs.rm(path.join(outDir, ZIP_NAME), { force: true })
    await new Promise((resolve, reject) => {
      // -X: 타임스탬프·확장 속성을 빼서 내용이 같으면 같은 zip 이 나오게 한다.
      const child = spawn('zip', ['-q', '-X', ZIP_NAME, ...entries], { cwd: outDir, stdio: 'ignore' })
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`zip exit ${code}`))))
      child.on('error', reject)
    })
    console.log(`묶음 갱신: ${ZIP_NAME} (${entries.length}개 파일)`)
  } catch (error) {
    console.warn(`묶음 zip 갱신을 건너뜁니다: ${error.message}`)
    console.warn('zip 명령이 없으면 개별 CSV와 묶음이 어긋난 채로 남습니다. 반드시 확인하세요.')
  }
}
