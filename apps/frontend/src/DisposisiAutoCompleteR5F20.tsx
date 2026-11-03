import { useEffect, useState } from 'react'
import { SubmitFinalR3D3 } from './LeadershipR3D3'

type Props = {
  taskId: string
  version: number
  issuerId: string
  currentUserId: string
  reviewStatus: 'not_ready' | 'awaiting_review' | 'approved' | 'revision_requested'
  status: 'pending' | 'in_progress' | 'completed'
}

type FinalInfo = {
  approval?: { status?: string }
  progress?: { progressPercent?: number; autoClosed?: boolean }
}

// Preserve legacy formal approval UI for any case not explicitly auto-closed
// by the authorized backend. The frontend does not decide permissions.
export function DisposisiAutoCompleteR5F20(props: Props) {
  const [auto, setAuto] = useState(false)
  useEffect(() => {
    if (props.issuerId !== props.currentUserId || props.status !== 'completed' || props.reviewStatus !== 'approved') {
      setAuto(false)
      return
    }
    let active = true
    fetch(`/api/v1/urmin/dispositions/${encodeURIComponent(props.taskId)}/final-status`, {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
    }).then(async response => {
      if (!response.ok) return null
      return response.json() as Promise<FinalInfo>
    }).then(data => {
      if (active) setAuto(data?.approval?.status === 'approved' && data?.progress?.autoClosed === true && data?.progress?.progressPercent === 100)
    }).catch(() => { if (active) setAuto(false) })
    return () => { active = false }
  }, [props.taskId, props.issuerId, props.currentUserId, props.status, props.reviewStatus, props.version])

  if (auto) {
    return <div role="status" className="sdl-tasks-r5f3__section">
      <strong>Disposisi selesai — 100%</strong>
      <p>Hasil tugas telah disetujui Kabagrenmin. Tidak memerlukan pengajuan akhir tambahan.</p>
    </div>
  }
  return <SubmitFinalR3D3 {...props} />
}
