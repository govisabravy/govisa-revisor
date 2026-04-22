"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud } from "lucide-react";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export default function UploadDropzone({ onFile, disabled }: Props) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) onFile(accepted[0]);
    },
    [onFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
    disabled
  });

  return (
    <div
      {...getRootProps()}
      className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition hover:border-slate-400 hover:scale-[1.01] ${
        isDragActive ? "border-govisa-navy bg-blue-50" : "border-slate-300 bg-white"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <input {...getInputProps()} />
      <div className="bg-slate-100 rounded-full p-3 mb-3">
        <UploadCloud className="w-12 h-12 text-govisa-navy" />
      </div>
      <p className="text-lg font-semibold text-slate-800">
        {isDragActive ? "Solte o PDF aqui" : "Arraste o processo em PDF ou clique para selecionar"}
      </p>
      <p className="text-sm text-slate-500 mt-1">
        PDF único contendo formulários USCIS + história + documentos
      </p>
    </div>
  );
}
