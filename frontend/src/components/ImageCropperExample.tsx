import { useState, type ChangeEvent } from 'react'
import ImageCropper from './ImageCropper'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Некорректный формат файла'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export default function ImageCropperExample() {
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [avatarImage, setAvatarImage] = useState<string | null>(null)

  const handlePickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    const dataUrl = await readFileAsDataUrl(file)
    setSourceImage(dataUrl)
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <label htmlFor="avatar-upload">Upload avatar image</label>
      <input id="avatar-upload" type="file" accept="image/*" onChange={(event) => void handlePickFile(event)} />

      {avatarImage ? (
        <img
          src={avatarImage}
          alt="Cropped avatar preview"
          style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.24)' }}
        />
      ) : null}

      {sourceImage ? (
        <ImageCropper
          imageSrc={sourceImage}
          aspect={1}
          onCancel={() => setSourceImage(null)}
          onSave={(croppedDataUrl) => {
            setAvatarImage(croppedDataUrl)
            setSourceImage(null)
          }}
        />
      ) : null}
    </div>
  )
}
