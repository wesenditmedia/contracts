// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

struct FeeEntry {
    address from;
    address to;
    uint256 percentage;
    address destination;
    bool doCallback;
}

interface IFeeReceiver {
    function onERC20Received(
        address from,
        address to,
        uint256 feeAmount
    ) external;
}

interface IDynamicFeeManager {
    event FeeAdded(
        address from,
        address to,
        uint256 percentage,
        address destination
    );
    event FeeRemoved(uint256 index);
    event FeeReflected(
        address token,
        address from,
        address to,
        uint256 tFee,
        address destination
    );

    function getFee(uint256 index) external view returns (FeeEntry memory fee);

    function addFee(
        address from,
        address to,
        uint256 percentage,
        address destination,
        bool doCallback
    ) external returns (uint256 index);

    function removeFee(uint256 index) external;

    function reflectFees(
        address token,
        address from,
        address to,
        uint256 amount,
        bool dryRun
    ) external returns (uint256 tTotal, uint256 tFees);
}
