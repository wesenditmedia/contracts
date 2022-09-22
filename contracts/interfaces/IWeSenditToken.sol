// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IDynamicFeeManager.sol";

interface IWeSenditToken {
    /**
     * Emitted on minimum transaction amount update
     *
     * @param minTxAmount uint256 - New minimum transaction amount
     */
    event MinTxAmountUpdated(uint256 minTxAmount);

    /**
     * Emitted on transaction pause update
     *
     * @param paused bool - Indicates if the transactions are paused now
     */
    event PausedUpdated(bool paused);

    /**
     * Emitted on dynamic fee manager update
     *
     * @param newAddress address - New dynamic fee manager address
     */
    event DynamicFeeManagerUpdated(address newAddress);

    /**
     * Returns the initial supply
     *
     * @return value uint256 - Initial supply
     */
    function initialSupply() external pure returns (uint256 value);

    /**
     * Returns the minimum transaction amount
     *
     * @return value uint256 - Minimum transaction amount
     */
    function minTxAmount() external view returns (uint256 value);

    /**
     * Sets the minimum transaction amount
     *
     * @param value uint256 - Minimum transaction amount
     */
    function setMinTxAmount(uint256 value) external;

    /**
     * Returns true if transactions are pause, false if unpaused
     *
     * @param value bool - Indicates if transactions are paused
     */
    function paused() external view returns (bool value);

    /**
     * Sets the transaction pause state
     *
     * @param value bool - true to pause transactions, false to unpause
     */
    function setPaused(bool value) external;

    /**
     * Returns the dynamic fee manager
     *
     * @return value IDynamicFeeManager - Dynamic Fee Manager
     */
    function dynamicFeeManager()
        external
        view
        returns (IDynamicFeeManager value);

    /**
     * Sets the dynamic fee manager
     *
     * @param value address - New dynamic fee manager address
     */
    function setDynamicFeeManager(address value) external;

    /**
     * Transfers token from <from> to <to> without applying fees
     *
     * @param from address - Sender address
     * @param to address - Receiver address
     * @param amount uin256 - Transaction amount
     */
    function transferFromNoFees(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
}
