/* global browser */

const storage = browser.storage.local
const background = browser.extension.getBackgroundPage()

storage.get().then(function (items) {
  document.querySelector('form').addEventListener('submit', function (event) {
    event.preventDefault()
  })

  const textKeys = ['textDomain', 'textToken']
  textKeys.forEach(key => {
    if (items[key]) document.querySelector(`#${key}`).value = items[key]
  })

  // Defaults to checked
  if (items.autoCopyUrl !== false)
    document.querySelector('#autoCopyUrl').checked = true
})

document.querySelector('#reset').addEventListener('click', async function () {
  document.querySelector('#textDomain').value = ''
  document.querySelector('#textToken').value = ''
  document.querySelector('#autoCopyUrl').checked = true

  let notificationID
  try {
    await storage.clear()
    notificationID = await background.notifications.create('Settings cleared.')
  } catch (error) {
    notificationID = await background.notifications.create(error.toString())
  }
  return background.notifications.clear(notificationID, 5000)
})

document.querySelector('#save').addEventListener('click', async function () {
  const textDomain = document.querySelector('#textDomain').value || null
  const textToken = document.querySelector('#textToken').value || null
  const autoCopyUrl = document.querySelector('#autoCopyUrl').checked

  if (textDomain) {
    if (!/^https?:\/\//.test(textDomain))
      return alert('Domain must begin with a valid HTTP/HTTPS protocol.')

    if (/\/$/.test(textDomain))
      return alert('Domain should not have a trailing slash.')
  }

  let notificationID
  try {
    await storage.set({ textDomain, textToken, autoCopyUrl })
    notificationID = await background.notifications.create('Settings saved.')
    await background.createMenus()
  } catch (error) {
    notificationID = await background.notifications.create(error.toString())
  }
  return background.notifications.clear(notificationID, 5000)
})
