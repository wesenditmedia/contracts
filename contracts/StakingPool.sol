// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./BaseStakingPool.sol";

/**
 * @title WeSendit Staking Pool
 */
contract StakingPool is BaseStakingPool {
    constructor() {}

    function totalTokenLocked()
        external
        pure
        override
        returns (uint256 value)
    {}

    function minDuration() external pure override returns (uint256 duration) {}

    function maxAmount() external pure override returns (uint256 amount) {}

    function poolAllocation()
        external
        pure
        override
        returns (uint256 allocation)
    {}

    function pendingRewards()
        external
        pure
        override
        returns (uint256 pendingRewards)
    {}

    function lastRewardsBlock()
        external
        pure
        override
        returns (uint256 block)
    {}

    function getEntries(
        address account
    ) external view override returns (PoolEntry[] memory entries) {}

    function stake(
        uint256 amount,
        uint256 duration
    ) external override returns (bytes32 entryId) {}

    function unstake(bytes32 entryId) external override {}

    function compound(bytes32 entryId) external override {}

    function updatePool() external override {}

    function emergencyWithdraw(uint256 amount) external override {}

    function emergencyWithdrawToken(
        address token,
        uint256 amount
    ) external override {}
}
