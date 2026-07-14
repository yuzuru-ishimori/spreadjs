// プロトコルの数値パラメータ（client/server 共有・DD-015）。protocol.ts は型のみゆえ、両端が同一値で判定する必要のある
// ランタイム定数はここへ置く（server=room.ts・client=session.ts が import し、閾値の乖離を構造的に防ぐ）。

/**
 * catch-up の snapshot 再取得閾値 T（DD-015 要確認②・確定値 1,000）。
 * 再接続時、未受信 revision 差分（frontier − lastAppliedRevision）が **この値を超えたら** 差分 pull ではなく
 * snapshot 再取得（document@frontier＝DD-014 bootstrap 経路）へ切り替える。**client と server が同一の
 * (frontier, lastAppliedRevision) から同一判定を導く**ため単一定数を共有する（DD-014 snapshot 生成間隔 N と同値）。
 */
export const CATCHUP_SNAPSHOT_THRESHOLD = 1_000;
