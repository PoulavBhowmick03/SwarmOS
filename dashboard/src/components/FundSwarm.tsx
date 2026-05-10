'use client'

import { useState } from 'react'
import { buildJumperUrl, SOLANA_CHAIN_ID, USDC_ON_SOLANA } from '@/lib/lifi'

interface Props {
  treasuryAddress: string
  recipientWallet?: string
}

export function FundSwarm({ treasuryAddress, recipientWallet = treasuryAddress }: Props) {
  const [isOpen, setIsOpen] = useState(false)

  const jumperUrl = buildJumperUrl(recipientWallet)
  const widgetUrl = `https://jumper.exchange/?fromChain=1&toChain=${SOLANA_CHAIN_ID}&toToken=${USDC_ON_SOLANA}&toWalletAddress=${encodeURIComponent(recipientWallet)}`

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: 6,
          border: '1px solid #9945FF60',
          background: '#9945FF18',
          color: '#9945FF',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'var(--mono)',
          fontWeight: 600,
          letterSpacing: '0.04em',
          transition: 'all 0.15s',
          outline: 'none',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#9945FF30'
          e.currentTarget.style.borderColor = '#9945FF'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = '#9945FF18'
          e.currentTarget.style.borderColor = '#9945FF60'
        }}
      >
        <span style={{ fontSize: 14 }}>⚡</span>
        Fund Swarm
      </button>

      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setIsOpen(false) }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.75)',
              backdropFilter: 'blur(6px)',
            }}
          />

          <div
            style={{
              position: 'relative',
              background: 'var(--bg-2)',
              border: '1px solid var(--rule)',
              borderRadius: 12,
              padding: '24px',
              maxWidth: 520,
              width: '100%',
              fontFamily: 'var(--mono)',
            }}
          >
            <button
              onClick={() => setIsOpen(false)}
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                background: 'var(--bg-3)',
                border: '1px solid var(--rule)',
                borderRadius: 4,
                padding: '3px 8px',
                cursor: 'pointer',
                color: 'var(--ink-3)',
                fontSize: 12,
              }}
            >
              ✕
            </button>

            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, fontFamily: 'var(--display)', color: 'var(--ink)' }}>
                Fund Swarm Treasury
              </h2>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-3)' }}>
                Bridge USDC from any supported chain to Solana via LI.FI
              </p>
            </div>

            <div
              style={{
                background: 'var(--bg-3)',
                border: '1px solid var(--rule)',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 16,
                fontSize: 11,
              }}
            >
              <div style={{ color: 'var(--ink-4)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                Treasury address (Solana)
              </div>
              <div style={{ color: 'var(--ink)', wordBreak: 'break-all', fontFamily: 'var(--mono)' }}>
                {treasuryAddress}
              </div>
            </div>

            {recipientWallet !== treasuryAddress && (
              <div
                style={{
                  background: 'var(--bg-3)',
                  border: '1px solid var(--rule)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  marginBottom: 16,
                  fontSize: 11,
                }}
              >
                <div style={{ color: 'var(--ink-4)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                  Recipient wallet
                </div>
                <div style={{ color: 'var(--ink)', wordBreak: 'break-all', fontFamily: 'var(--mono)' }}>
                  {recipientWallet}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <iframe
                src={widgetUrl}
                title="LI.FI Bridge Widget"
                style={{
                  width: '100%',
                  height: 420,
                  border: 'none',
                  borderRadius: 8,
                  background: '#0a0a0a',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <a
                href={jumperUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid var(--rule)',
                  background: 'var(--bg)',
                  color: 'var(--ink-2)',
                  fontSize: 11,
                  fontFamily: 'var(--mono)',
                  textDecoration: 'none',
                }}
              >
                Open Jumper.exchange ↗
              </a>
            </div>

            <div
              style={{
                marginTop: 14,
                padding: '8px 10px',
                background: 'var(--bg-3)',
                borderRadius: 5,
                fontSize: 10,
                color: 'var(--ink-4)',
                lineHeight: 1.5,
              }}
            >
              Funds bridge to Solana and land as USDC at the swarm treasury.
              Powered by LI.FI · Jumper Exchange.
            </div>
          </div>
        </div>
      )}
    </>
  )
}
