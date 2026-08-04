// 공통 GitHub 연동 모듈 (issue.html, verify.html 둘 다 사용)
// vouchers.json 파일을 GitHub 저장소에서 직접 읽고/고쳐씁니다.
//
// ⚠️ 보안 주의: 여기서 쓰는 GitHub 토큰은 브라우저(클라이언트)에 그대로 노출됩니다.
// 반드시 "이 저장소 하나에만, Contents 권한만" 부여한 Fine-grained PAT를 사용하세요.
// 발급: https://github.com/settings/personal-access-tokens/new

const GH_CONFIG_KEY = 'voucherGithubConfig';

function ghLoadConfig() {
  return JSON.parse(localStorage.getItem(GH_CONFIG_KEY) || '{}');
}

function ghSaveConfig(cfg) {
  localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(cfg));
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function b64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array([...binary].map(c => c.charCodeAt(0)));
  return new TextDecoder('utf-8').decode(bytes);
}

function ghApiUrl(cfg) {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;
}

// vouchers.json을 읽어옵니다. 파일이 없으면 { list: [], sha: null } 반환.
async function ghGetFile(cfg, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ghApiUrl(cfg)}?ref=${encodeURIComponent(cfg.branch || 'main')}`, {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json'
      },
      signal: controller.signal
    });
    if (res.status === 404) return { list: [], sha: null };
    if (!res.ok) throw new Error(`GitHub 조회 실패 (${res.status})`);
    const data = await res.json();
    const text = b64DecodeUtf8(data.content);
    const list = text.trim() ? JSON.parse(text) : [];
    return { list, sha: data.sha };
  } finally {
    clearTimeout(timer);
  }
}

// vouchers.json을 갱신합니다. sha가 바뀌어 충돌(409)나면 최신 데이터로 다시 받아서
// updateFn(freshList)로 재적용 후 재시도합니다 (최대 retries회).
async function ghPutFile(cfg, updateFn, message, retries = 3) {
  let { list, sha } = await ghGetFile(cfg);
  for (let attempt = 0; attempt < retries; attempt++) {
    const newList = updateFn(list);
    const body = {
      message,
      content: b64EncodeUtf8(JSON.stringify(newList, null, 2)),
      branch: cfg.branch || 'main'
    };
    if (sha) body.sha = sha;

    const res = await fetch(ghApiUrl(cfg), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (res.ok) return newList;

    if (res.status === 409 || res.status === 422) {
      // 다른 기기가 먼저 저장함 → 최신 상태 다시 받아서 재시도
      ({ list, sha } = await ghGetFile(cfg));
      continue;
    }
    const errText = await res.text().catch(() => '');
    throw new Error(`GitHub 저장 실패 (${res.status}) ${errText}`);
  }
  throw new Error('저장 충돌이 반복되어 실패했습니다. 다시 시도해주세요.');
}
