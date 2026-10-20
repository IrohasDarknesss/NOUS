// 様式①：画面中央のモーダル。401 のときは OK で /login へ
import { useNavigate } from "react-router-dom";
import { Modal, primaryButtonStyle } from "./Modal";

export interface ErrorModalProps {
  message: string | null;
  onClose: () => void;
  redirectTo?: string;
}

export function ErrorModal({ message, onClose, redirectTo }: ErrorModalProps) {
  const navigate = useNavigate();
  if (!message) return null;

  const handleOk = () => {
    onClose();
    if (redirectTo) navigate(redirectTo);
  };

  return (
    <Modal labelledBy="error-modal-title">
      <h2 id="error-modal-title" style={{ fontSize: 18, margin: "0 0 12px" }}>
        エラー
      </h2>
      <p style={{ margin: "0 0 20px", whiteSpace: "pre-wrap" }}>{message}</p>
      <div style={{ textAlign: "right" }}>
        <button type="button" onClick={handleOk} style={primaryButtonStyle} autoFocus>
          OK
        </button>
      </div>
    </Modal>
  );
}
