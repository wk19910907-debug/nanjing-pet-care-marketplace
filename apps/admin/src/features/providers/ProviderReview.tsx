export function ProviderReview(props: { approved: boolean; approve(): void }) {
  return <section><h2>服务者审核</h2><div className="card"><strong>王小宁 · {props.approved ? '已批准' : '待审核'}</strong>
    <p>上门喂猫 24 个月经验 · 建邺区奥体东 · 材料已提交</p>
    {!props.approved && <button onClick={props.approve}>批准服务者</button>}</div></section>;
}
