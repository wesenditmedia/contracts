// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface ITokenVault {
    /**
     * Emitted on vault lock
     */
    event Locked();

    /**
     * Emitted on vault unlock
     */
    event Unlocked();

    /**
     * Emitted on token withdrawal
     *
     * @param receiver address - Receiver of token
     * @param token address - Token address
     * @param amount uint256 - token amount
     */
    event WithdrawToken(address receiver, address token, uint256 amount);

    /**
     * Locks the vault
     */
    function lock() external;

    /**
     * Unlocks the vault
     */
    function unlock() external;

    /**
     * Withdraws token stores at the contract
     *
     * @param token address - Token to withdraw
     * @param amount uint256 - Amount of token to withdraw
     */
    function withdrawToken(address token, uint256 amount) external;
}
