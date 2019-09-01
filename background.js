/* global browser, axios */

const title = 'lolisafe'

browser.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'update') {
    /* == Made changes to storage names. == */
    // browser.storage.local.clear();
  }
})

let config
browser.storage.local.get().then(function (items) {
  config = items
  createMenus()
})

browser.storage.onChanged.addListener(function (changes, namespace) {
  for (const key in changes)
    config[key] = changes[key].newValue
})

const createMenus = async function (refresh) {
  if (!config) config = {}
  if (!config.textDomain) config.textDomain = 'https://safe.fiery.me'

  const uploadable = ['image', 'video', 'audio']
  const uploadablePlus = uploadable.concat(['page'])

  const menus = {
    parent: null,
    children: {},
    createMenu (id, name) {
      const CM = browser.menus.create({
        title: name.replace('&', '&&'),
        parentId: menus.parent,
        contexts: uploadablePlus,
        onclick (info) {
          if (info.srcUrl)
            upload(info.srcUrl, info.pageUrl, menus.children[info.menuItemId])
          else
            uploadScreenshot(menus.children[info.menuItemId])
        }
      }, function (a) {
        menus.children[CM] = id // Binds the Album ID to the Context Menu ID
      })
    }
  }

  await browser.menus.removeAll()

  /* == Parent Context Menu == */
  menus.parent = browser.menus.create({
    title,
    contexts: ['all']
  })

  if (config.textToken) {
    browser.menus.create({
      title: 'Go to dashboard',
      parentId: menus.parent,
      contexts: ['all'],
      onclick () {
        browser.tabs.create({
          url: `${config.textDomain}/dashboard`
        })
      }
    })

    /* == Refresh == */
    browser.menus.create({
      title: 'Refresh albums list',
      parentId: menus.parent,
      contexts: uploadablePlus,
      onclick () {
        createMenus(true)
      }
    })

    /* == Separator == */
    browser.menus.create({
      parentId: menus.parent,
      contexts: uploadablePlus,
      type: 'separator'
    })
  }

  /* == Upload normally == */
  browser.menus.create({
    title: 'Send file to safe',
    parentId: menus.parent,
    contexts: uploadable,
    onclick (info) {
      upload(info.srcUrl, info.pageUrl)
    }
  })

  browser.menus.create({
    title: 'Screenshot visible page',
    parentId: menus.parent,
    contexts: ['page'],
    onclick (info) {
      uploadScreenshot()
    }
  })

  if (config.textToken) {
    /* == Separator == */
    browser.menus.create({
      parentId: menus.parent,
      contexts: uploadablePlus,
      type: 'separator'
    })

    let notificationID
    if (refresh)
      notificationID = await notifications.create('Refreshing\u2026')

    let errored = false
    try {
      const response = await axios.get(`${config.textDomain}/api/albums`, {
        headers: { token: config.textToken }
      })

      if (response.data.albums.length === 0) {
        browser.menus.create({
          title: 'No albums available',
          parentId: menus.parent,
          contexts: uploadablePlus,
          type: 'normal',
          enabled: false
        })
      } else {
        console.log(`Fetched ${response.data.albums.length} album(s).`)
        browser.menus.create({
          title: 'Upload file to:',
          parentId: menus.parent,
          contexts: uploadable,
          type: 'normal',
          enabled: false
        })
        browser.menus.create({
          title: 'Upload screenshot to:',
          parentId: menus.parent,
          contexts: ['page'],
          type: 'normal',
          enabled: false
        })
        response.data.albums.forEach(function (album) {
          menus.createMenu(album.id, album.name)
        })
      }
    } catch (error) {
      errored = true
      browser.menus.create({
        title: 'Error fetching albums',
        parentId: menus.parent,
        contexts: uploadablePlus,
        type: 'normal',
        enabled: false
      })
    }

    if (notificationID) {
      const message = errored
        ? 'Error fetching albums.'
        : 'Refresh completed.'
      await notifications.update(notificationID, { message })
      return notifications.clear(notificationID, 5000)
    }
  }
}

const upload = async function (url, pageURL, albumid) {
  const notificationID = await notifications.create('Retrieving file\u2026')

  try {
    // Intercept request to add Referer header
    // Using axios options is not possible due to Referer
    // being one of the forbidden header names
    // Source: https://fetch.spec.whatwg.org/#forbidden-header-name
    const interceptRequest = function (details) {
      if (details.tabId === -1 && details.method === 'GET' && details.url === url)
        details.requestHeaders.push({ name: 'Referer', value: pageURL })
      return { requestHeaders: details.requestHeaders }
    }

    browser.webRequest.onBeforeSendHeaders
      .addListener(interceptRequest, { urls: [url] }, ['blocking', 'requestHeaders'])

    const file = await axios.get(url, { responseType: 'blob' })

    browser.webRequest.onBeforeSendHeaders
      .removeListener(interceptRequest)

    const formData = new FormData()
    formData.append('files[]', file.data, `lolisafe_file${fileExt(file.data.type)}`)

    return uploadFinally(formData, albumid, notificationID)
  } catch (error) {
    console.error(error)
    await notifications.update(notificationID, {
      message: error.toString(),
      contextMessage: url
    })
    return notifications.clear(notificationID, 5000)
  }
}

const uploadScreenshot = async function (albumid) {
  const notificationID = await notifications.create('Capturing tab\u2026')

  try {
    const captured = await browser.tabs.captureVisibleTab({ format: 'png' })
    const blob = b64toBlob(captured.replace('data:image/png;base64,', ''), 'image/png')

    const formData = new FormData()
    formData.append('files[]', blob, 'lolisafe_screenshot.png')

    return uploadFinally(formData, albumid, notificationID)
  } catch (error) {
    console.error(error)
    await notifications.update(notificationID, {
      message: error.toString()
    })
    return notifications.clear(notificationID, 5000)
  }
}

const uploadFinally = async function (formData, albumId, notificationID) {
  let lastProgTime = Date.now()
  const options = {
    method: 'POST',
    url: `${config.textDomain}/api/upload`,
    data: formData,
    headers: {},
    onUploadProgress (progress) {
      // Add a minimum of 1000ms delay between each progress notification
      if (Date.now() - lastProgTime < 1000) return
      lastProgTime = Date.now()
      notifications.update(notificationID, {
        progress: Math.round((progress.loaded * 100) / progress.total)
      })
    }
  }

  if (config.textToken)
    options.headers.token = config.textToken

  if (albumId && config.textToken)
    options.url = `${options.url}/${albumId}`

  await notifications.update(notificationID, {
    message: 'Uploading\u2026',
    progress: 0
  })

  const response = await axios(options)

  if (response.data.success !== true)
    throw new Error(response.data.description)

  let copied
  if (config.autoCopyUrl !== false)
    copied = await copyText(response.data.files[0].url)

  await notifications.update(notificationID, {
    message: copied
      ? 'Uploaded and copied URL to clipboard.'
      : 'Upload completed.',
    contextMessage: response.data.files[0].url,
    toCopy: copied
      ? null
      : response.data.files[0].url
  })
  return notifications.clear(notificationID, 10000)
}

const mimetypes = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mp4': '.mp4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/x-aac': '.aac',
  'audio/x-wav': '.wav'
}

const fileExt = function (mimetype) {
  return mimetypes[mimetype] || `.${mimetype.split('/')[1]}`
}

const copyText = async function (text) {
  try {
    // Firefox can't copy to clipboard from background script
    await browser.tabs.executeScript({
      code: `
        (function () {
          const input = document.createElement('textarea')
          document.body.appendChild(input)
          input.value = ${JSON.stringify(text)}
          input.select()
          document.execCommand('Copy')
          input.remove()
        })()
      `
    })
    return true
  } catch (error) {
    console.error('Unable to execute script on the tab.')
    return false
  }
}

// http://stackoverflow.com/a/16245768
const b64toBlob = function (b64Data, contentType, sliceSize) {
  contentType = contentType || ''
  sliceSize = sliceSize || 512

  const byteCharacters = atob(b64Data)
  const byteArrays = []

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize)

    const byteNumbers = new Array(slice.length)
    for (let i = 0; i < slice.length; i++)
      byteNumbers[i] = slice.charCodeAt(i)

    const byteArray = new Uint8Array(byteNumbers)

    byteArrays.push(byteArray)
  }

  const blob = new Blob(byteArrays, { type: contentType })
  return blob
}

const notifications = {
  caches: {},
  compat (_options) {
    // Compatibility for Firefox, due to very limited notification support
    const options = {}
    Object.assign(options, _options)

    if (options.progress !== undefined) {
      const progress = parseInt(options.progress)
      if (!isNaN(progress))
        options.message += ` (${options.progress}%)`
    }

    if (options.contextMessage)
      options.message += `\n${options.contextMessage}`

    delete options.progress
    delete options.contextMessage
    delete options.toCopy

    return options
  },
  async create (message, contextMessage, progress) {
    const options = {
      type: 'basic',
      title,
      message,
      contextMessage,
      progress,
      iconUrl: 'logo-128x128.png'
    }

    const id = `lolisafe_${Date.now()}`

    // Cache options
    notifications.caches[id] = options
    return browser.notifications.create(id, notifications.compat(options))
  },
  async update (id, options = {}) {
    // Firefox does not have built-in notification update function
    const properties = ['title', 'message', 'type', 'iconUrl']

    // Re-use cache of properties with keys specified above
    const cache = notifications.caches[id]
    if (cache)
      for (const property of properties)
        if (options[property] === undefined)
          options[property] = cache[property]

    // Cache options
    notifications.caches[id] = options
    return browser.notifications.create(id, notifications.compat(options))
  },
  async clear (id, timeout) {
    if (timeout)
      await new Promise(function (resolve) {
        setTimeout(function () {
          return resolve()
        }, timeout)
      })
    delete notifications.caches[id]
    return browser.notifications.clear(id)
  }
}

browser.notifications.onClicked.addListener(async function (id) {
  // If the URL was not auto-copied, try again when clicking the notification
  const toCopy = notifications.caches[id].toCopy
  if (toCopy) await copyText(toCopy)
  return notifications.clear(id)
})

window.notifications = notifications
window.createMenus = createMenus
