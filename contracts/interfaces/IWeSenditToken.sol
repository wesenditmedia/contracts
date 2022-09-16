// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IPancakeRouter.sol";

struct FeeEntry {
    address from;
    address to;
    uint256 percentage;
    address destination;
    // bool callbackEnabled
}

interface IWeSenditToken {
    /**
     * Events
     */
    event MinTxAmountUpdated(uint256 minTxAmount);
    event PausedUpdated(bool paused);
    event PancakeRouterUpdated(address newAddress);
    event SwapAndLiquifyEnabledUpdated(bool enabled);
    event SwapAndLiquifyBalanceUpdated(uint256 value);
    event SwapAndLiquify(uint256 firstHalf, uint256 newBalance, uint256 secondHalf);
    event FeeEnabledUpdated(bool enabled);
    event StakingPoolAddressUpdated(address newAddress);
    event FeeAdded(address from, address to, uint256 percentage, address destination);
    event FeeRemoved(uint256 index);
    event EmergencyWithdraw(address receiver, uint256 amount);
    event EmergencyWithdrawToken(address receiver, uint256 amount);

    // Supply (totalSupply already provided by IERC20)
    function initialSupply() external pure returns (uint256);

    // Minimal transaction amount
    function minTxAmount() external view returns (uint256);

    function setMinTxAmount(uint256 value) external;

    // Transaction pause
    function paused() external view returns (bool);

    function setPaused(bool value) external;

    // Pancakeswap Router
    function pancakeRouter() external view returns (IPancakeRouter02);

    function setPancakeRouter(address value) external;

    // Swap and Liquify
    function swapAndLiquifyEnabled() external view returns (bool);

    function setSwapAndLiquifyEnabled(bool value) external;

    function swapAndLiquifyBalance() external view returns (uint256);

    function setSwapAndLiquifyBalance(uint256 value) external;

    /**
     * Dynamic Fee System
     */
    function feesEnabled() external view returns (bool);

    function setFeesEnabled(bool value) external;

    function getFee(uint256 index) external view returns (FeeEntry memory fee);

    function addFee(
        address from,
        address to,
        uint256 percentage,
        address destination
    ) external returns (uint256 index);

    function removeFee(uint256 index) external;

    function stakingPoolAddress() external view returns (address);

    function setStakingPoolAddress(address value) external;

    /**
     * Emergency withdraw
     */
    function emergencyWithdraw(uint256 amount) external;

    function emergencyWithdrawToken(uint256 amount) external;
}
