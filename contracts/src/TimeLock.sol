// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TimeLock — Lit Protocol access control condition
/// @notice Used as an onchain condition for time-locked decryption of vote rationale
contract TimeLock {
    function isAfterTimestamp(uint256 timestamp) external view returns (bool) {
        return block.timestamp >= timestamp;
    }
}
