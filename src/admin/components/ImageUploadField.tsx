import { useRef, useState } from 'react'
import { ImageUp, X } from 'lucide-react'
import { api } from '@/services/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button, Input } from '@/components/ui'
import { SmartImage } from '@/components/common/SmartImage'
import { cn } from '@/lib/cn'

interface Props {
  label: string
  value: string
  onChange: (url: string) => void
  error?: string
  hint?: string
  required?: boolean
  preview?: boolean
  previewClassName?: string
  wrapperClassName?: string
  placeholder?: string
}

/**
 * Image URL input with an "Upload" button: the file goes to the API (POST /uploads),
 * which validates it and returns a permanent URL that is put into the field.
 */
export function ImageUploadField({ label, value, onChange, error, hint, required, preview = false, previewClassName, wrapperClassName, placeholder }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const toast = useToast()
  const { can } = useAuth()

  const onFile = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try {
      const res = await api.uploadImage(file)
      onChange(res.url)
      toast({ title: 'Image uploaded', description: 'Save the form to use it on the website.' })
    } catch (e) {
      toast({ tone: 'error', title: 'Upload failed', description: e instanceof Error ? e.message : 'Try a smaller image.' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className={cn('grid gap-2', wrapperClassName)}>
      {preview && value && <SmartImage src={value} alt="Preview" className={cn('aspect-[16/9] w-full rounded-card border border-line', previewClassName)} />}
      <div className="flex items-end gap-2">
        <Input label={label} value={value} required={required} error={error} hint={hint ?? 'Upload a file, or paste an https:// link or /images/… path.'} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.trim())} wrapperClassName="flex-1 min-w-0" />
        {can('uploads:write') && (
          <div className={cn('flex gap-1', (error || hint !== '') && 'mb-[1.65rem]')}>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={uploading} leftIcon={<ImageUp className="size-4" />} aria-label={`Upload ${label}`}>
              <span className="hidden sm:inline">Upload</span>
            </Button>
            {value && <Button variant="ghost" onClick={() => onChange('')} aria-label={`Clear ${label}`}><X className="size-4" /></Button>}
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  )
}
