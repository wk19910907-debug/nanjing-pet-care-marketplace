import { useCallback, useEffect, useState } from 'react';
import { NANJING_DISTRICTS } from '@pet/contracts';
import type { PilotApi } from './api.js';
import type {
  AdminOperationsCatalog,
  NanjingDistrictCode,
  OperationsCatalogUpdate,
} from './models.js';

type Props = {
  api: PilotApi;
  onError(caught: unknown): string | null;
};

type Draft = {
  catEnabled: boolean;
  catPriceYuan: string;
  dogEnabled: boolean;
  dogPriceYuan: string;
  openDistricts: NanjingDistrictCode[];
  announcement: string;
};

function toDraft(catalog: AdminOperationsCatalog): Draft {
  return {
    catEnabled: catalog.services.CAT_FEEDING.enabled,
    catPriceYuan: String(catalog.services.CAT_FEEDING.basePriceFen / 100),
    dogEnabled: catalog.services.DOG_WALKING.enabled,
    dogPriceYuan: String(catalog.services.DOG_WALKING.basePriceFen / 100),
    openDistricts: [...catalog.openDistricts],
    announcement: catalog.announcement,
  };
}

function priceFen(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const yuan = Number(value);
  if (!Number.isFinite(yuan) || yuan <= 0 || yuan > 1_000) return null;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function OperationsSettingsPanel({ api, onError }: Props) {
  const [catalog, setCatalog] = useState<AdminOperationsCatalog | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSaved('');
    try {
      const next = await api.getAdminCatalog();
      setCatalog(next);
      setDraft(toDraft(next));
    } catch (caught) {
      setError(onError(caught) ?? '运营配置暂时不可用');
    } finally {
      setLoading(false);
    }
  }, [api, onError]);

  useEffect(() => { void load(); }, [load]);

  const toggleDistrict = (code: NanjingDistrictCode) => {
    setDraft((current) => current && ({
      ...current,
      openDistricts: current.openDistricts.includes(code)
        ? current.openDistricts.filter((item) => item !== code)
        : NANJING_DISTRICTS
            .map((district) => district.code)
            .filter((item) => [...current.openDistricts, code].includes(item)),
    }));
  };

  const save = async () => {
    if (!catalog || !draft || saving) return;
    const catBasePriceFen = priceFen(draft.catPriceYuan);
    const dogBasePriceFen = priceFen(draft.dogPriceYuan);
    if (catBasePriceFen === null || dogBasePriceFen === null) {
      setError('起步价需为 0.01 至 1000 元之间的有效金额');
      return;
    }
    if (draft.openDistricts.length === 0) {
      setError('至少保留一个开放区域');
      return;
    }
    const input: OperationsCatalogUpdate = {
      expectedVersion: catalog.version,
      services: {
        CAT_FEEDING: { enabled: draft.catEnabled, basePriceFen: catBasePriceFen },
        DOG_WALKING: { enabled: draft.dogEnabled, basePriceFen: dogBasePriceFen },
      },
      openDistricts: draft.openDistricts,
      announcement: draft.announcement.trim(),
    };
    setSaving(true);
    setError('');
    setSaved('');
    try {
      const updated = await api.updateAdminCatalog(input);
      setCatalog(updated);
      setDraft(toDraft(updated));
      setSaved('运营配置已保存');
    } catch (caught) {
      setError(onError(caught) ?? '保存失败，请重新读取配置');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="pilot-owner-loading">正在读取运营配置…</div>;
  if (!catalog || !draft) return <section className="pilot-ops-section"><h2>运营配置</h2>{error && <p className="pilot-error" role="alert">{error}</p>}<button type="button" onClick={() => void load()}>重新读取配置</button></section>;

  return <section className="pilot-ops-section pilot-operations-settings" aria-labelledby="operations-settings-title">
    <div className="pilot-ops-card-head">
      <div><p className="pilot-kicker">网站与小程序共用</p><h2 id="operations-settings-title">运营配置</h2></div>
      <span className="pilot-status">版本 {catalog.version}</span>
    </div>
    <p className="pilot-hint">保存后，新报价立即使用本配置；历史订单金额不会改变。</p>
    <div className="pilot-settings-services">
      <fieldset className="pilot-settings-service">
        <legend>上门喂猫</legend>
        <label><input type="checkbox" checked={draft.catEnabled} onChange={(event) => setDraft({ ...draft, catEnabled: event.target.checked })}/> 开放上门喂猫</label>
        <label>上门喂猫起步价<input aria-label="上门喂猫起步价" type="number" min="0.01" max="1000" step="0.01" value={draft.catPriceYuan} onChange={(event) => setDraft({ ...draft, catPriceYuan: event.target.value })}/><span>元</span></label>
      </fieldset>
      <fieldset className="pilot-settings-service">
        <legend>上门遛狗</legend>
        <label><input type="checkbox" checked={draft.dogEnabled} onChange={(event) => setDraft({ ...draft, dogEnabled: event.target.checked })}/> 开放上门遛狗</label>
        <label>上门遛狗起步价<input aria-label="上门遛狗起步价" type="number" min="0.01" max="1000" step="0.01" value={draft.dogPriceYuan} onChange={(event) => setDraft({ ...draft, dogPriceYuan: event.target.value })}/><span>元</span></label>
      </fieldset>
    </div>
    <fieldset className="pilot-settings-districts">
      <legend>开放服务区域</legend>
      {NANJING_DISTRICTS.map(({ code, name }) => <label key={code}><input type="checkbox" checked={draft.openDistricts.includes(code)} onChange={() => toggleDistrict(code)}/>{name}</label>)}
    </fieldset>
    <label className="pilot-settings-announcement">运营公告<textarea aria-label="运营公告" maxLength={120} value={draft.announcement} onChange={(event) => setDraft({ ...draft, announcement: event.target.value })} placeholder="为空时不展示公告"/></label>
    {error && <p className="pilot-error" role="alert">{error}</p>}
    {saved && <p className="pilot-success" role="status">{saved}</p>}
    <div className="pilot-settings-actions">
      <button type="button" disabled={saving} onClick={() => void save()}>{saving ? '正在保存…' : '保存运营配置'}</button>
      {error && <button type="button" className="pilot-secondary" disabled={saving} onClick={() => void load()}>重新读取配置</button>}
    </div>
    <p className="pilot-hint">最后更新：{new Date(catalog.updatedAt).toLocaleString('zh-CN')}</p>
  </section>;
}
