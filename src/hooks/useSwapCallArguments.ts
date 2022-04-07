import { Contract } from '@ethersproject/contracts'
import { JSBI, Percent, Router, SwapParameters, Trade, TradeType } from '@pancakeswap/sdk'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import { useMemo } from 'react'
import { BIPS_BASE, INITIAL_ALLOWED_SLIPPAGE } from '../config/constants'
import { getRouterContract } from '../utils'
import useENS from './ENS/useENS'
import { ApprovalState, useApproveCallbackFromTrade } from './useApproveCallback'
import useTransactionDeadline from './useTransactionDeadline'
import { useAmbireWalletContract } from './useContract'

interface SwapCall {
  contract: Contract
  parameters: SwapParameters
}

/**
 * Returns the swap calls that can be used to make the trade
 * @param trade trade to execute
 * @param allowedSlippage user allowed slippage
 * @param recipientAddressOrName
 */
export function useSwapCallArguments(
  trade: Trade | undefined, // trade to execute, required
  allowedSlippage: number = INITIAL_ALLOWED_SLIPPAGE, // in bips
  recipientAddressOrName: string | null, // the ENS name or address of the recipient of the trade, or null if swap should be returned to sender
): SwapCall[] {
  const { account, chainId, library } = useActiveWeb3React()

  const { address: recipientAddress } = useENS(recipientAddressOrName)
  const recipient = recipientAddressOrName === null ? account : recipientAddress
  const deadline = useTransactionDeadline()

  const ambireWalletContract = useAmbireWalletContract()
  const [approvalState] = useApproveCallbackFromTrade(trade, allowedSlippage)

  return useMemo(() => {
    if (!trade || !recipient || !library || !account || !chainId || !deadline) return []

    const contract = getRouterContract(chainId, library, account)
    if (!contract) {
      return []
    }

    const swapMethods = []

    swapMethods.push(
      Router.swapCallParameters(trade, {
        feeOnTransfer: false,
        allowedSlippage: new Percent(JSBI.BigInt(allowedSlippage), BIPS_BASE),
        recipient,
        deadline: deadline.toNumber(),
      }),
    )

    if (trade.tradeType === TradeType.EXACT_INPUT) {
      swapMethods.push(
        Router.swapCallParameters(trade, {
          feeOnTransfer: true,
          allowedSlippage: new Percent(JSBI.BigInt(allowedSlippage), BIPS_BASE),
          recipient,
          deadline: deadline.toNumber(),
        }),
      )
    }

    return swapMethods.map((parameters) => {
      if (ambireWalletContract && approvalState === ApprovalState.NOT_APPROVED) {
        // Using tryCatch as a byproduct to pass swap Calldata but avoid gas + simulation fail if not token is not approved as this transaction will not fail
        const swapData = contract.interface.encodeFunctionData(parameters.methodName, parameters.args)
        const swapCall = {
          parameters: {
            methodName: 'tryCatch',
            args: [contract.address, '0', swapData],
            value: '0',
          },
          contract: ambireWalletContract,
        }

        return swapCall
      }
      return { parameters, contract }
    })
  }, [account, allowedSlippage, ambireWalletContract, approvalState, chainId, deadline, library, recipient, trade])
}
