import { mailedCode } from '../../Tc_Engine_Web_backend/tests/email-helper.mjs'

// Use the real staged email flow and the test API's private mail pickup directory.
export async function signIn(page, directory, username, password, register = false) {
  if (register) await page.getByRole('button', { name: '切换到注册', exact: true }).click()
  await page.locator('#cloud-email').fill(`${username}@example.com`)
  await page.locator('#cloud-password').fill(password)
  if (register) {
    await page.getByRole('button', { name: '发送验证码', exact: true }).click()
    await page.locator('#cloud-code').waitFor()
    await page.locator('#cloud-code').fill(await mailedCode(directory, `${username}@example.com`))
    await page.getByRole('button', { name: '验证邮箱并创建账号', exact: true }).click()
  } else {
    await page.getByRole('button', { name: '登录', exact: true }).click()
  }
  await page.getByRole('button', { name: '退出账号', exact: true }).waitFor()
}
